// ========== TapBuzz 直连版 ==========
// 打开即用，分享给好友即可配对，无需房间号

const BROKER_URL = 'wss://broker-cn.emqx.io:8084/mqtt'   // 国内节点（更快）
// 备用: 'wss://broker.emqx.io:8084/mqtt'               // 国际节点

Page({
  data: {
    connected: false,
    paired: false,
    statusText: '初始化中...',
    btnIcon: '👆',
    btnLabel: '戳我',
    hint: '',
    _receiving: false,
    pageMode: 'loading',  // loading | created | paired
    // 聊天
    chatShow: false,
    chatInput: '',
    chatMessages: [],
    chatUnread: 0
  },

  mqttSocket: null,
  mqttConnected: false,
  myRoom: '',
  isPaired: false,
  pendingBuzz: false,
  pendingPing: false,

  onLoad(options) {
    if (options && options.room) {
      this.myRoom = options.room.toUpperCase()
      this.setData({ pageMode: 'joining' })
    }
    this.connectMqtt()
  },

  // ========== MQTT 连接 ==========
  connectMqtt() {
    wx.showLoading({ title: '连接中...', mask: true })
    this.mqttSocket = wx.connectSocket({
      url: BROKER_URL,
      protocols: ['mqtt']  // MQTT over WebSocket 需要此协议头
    })

    const self = this
    let connectTimer = null

    this.mqttSocket.onOpen(() => {
      this._sendConnect()
      connectTimer = setTimeout(() => {
        wx.showToast({ title: '连接超时', icon: 'error' })
      }, 5000)
    })

    let buffer = new Uint8Array(0)

    this.mqttSocket.onMessage((res) => {
      let data = res.data
      if (data instanceof ArrayBuffer) data = new Uint8Array(data)
      else return

      const newBuf = new Uint8Array(buffer.length + data.length)
      newBuf.set(buffer, 0)
      newBuf.set(data, buffer.length)
      buffer = newBuf

      while (buffer.length > 0) {
        const packetType = buffer[0] >> 4
        let remainingLen = 0
        let multiplier = 1
        let pos = 1
        while (pos < buffer.length) {
          const digit = buffer[pos]
          remainingLen += (digit & 127) * multiplier
          multiplier *= 128
          pos++
          if ((digit & 128) === 0) break
        }
        const totalLen = pos + remainingLen
        if (buffer.length < totalLen) break

        if (packetType === 2) {
          clearTimeout(connectTimer)
          wx.hideLoading()
          self.mqttConnected = true
          self.setData({ statusText: '已连接', connected: true })
          self._onConnected()
        }

        if (packetType === 3) {
          const pubPos = pos
          const topicLen = (buffer[pubPos] << 8) | buffer[pubPos + 1]
          const topicStart = pubPos + 2
          let topic = ''
          for (let i = 0; i < topicLen; i++) {
            topic += String.fromCharCode(buffer[topicStart + i])
          }
          const payloadStart = topicStart + topicLen
          let payload = ''
          for (let i = payloadStart; i < totalLen; i++) {
            payload += String.fromCharCode(buffer[i])
          }

          if (payload === 'buzz') {
            self.receiveBuzz()
          } else if (payload === 'ping') {
            if (!self.isPaired) {
              self.isPaired = true
              self.mqttPublish(self.myRoom, 'ping')  // 回发 ping 完成双向配对
              if (self.pendingBuzz) {
                self.pendingBuzz = false
                self.doEffect()
              }
              if (self.pendingPing) {
                self.pendingPing = false
              }
              self.setData({
                paired: true,
                pageMode: 'paired',
                hint: '连接成功！点下面按钮戳对方'
              })
            }
          } else if (payload.startsWith('msg:')) {
            // 聊天消息
            const text = payload.slice(4)
            self._receiveChat(text)
          }
        }

        if (packetType === 9) {
          if (self.pendingPing) {
            self.pendingPing = false
            self.mqttPublish(self.myRoom, 'ping')
          }
        }

        buffer = buffer.slice(totalLen)
      }
    })

    this.mqttSocket.onClose(() => {
      self.mqttConnected = false
      self.isPaired = false
      wx.hideLoading()
      self.setData({ connected: false, paired: false, statusText: '连接断开' })
      setTimeout(() => self.connectMqtt(), 2000)
    })

    this.mqttSocket.onError(() => {
      clearTimeout(connectTimer)
      wx.hideLoading()
      self.setData({ statusText: '连接失败，请检查网络' })
    })
  },

  _sendConnect() {
    const clientId = 'tapbuzz_' + Math.random().toString(36).slice(2, 10)
    const header = new Uint8Array([
      0x10, 0, 0, 6, 77, 81, 84, 84, 4, 2, 0, 60
    ])
    const remLen = 10 + 2 + clientId.length
    header[1] = remLen

    const ciBytes = new Uint8Array(2 + clientId.length)
    ciBytes[0] = (clientId.length >> 8) & 0xFF
    ciBytes[1] = clientId.length & 0xFF
    for (let i = 0; i < clientId.length; i++) {
      ciBytes[2 + i] = clientId.charCodeAt(i)
    }

    const packet = new Uint8Array(header.length + ciBytes.length)
    packet.set(header, 0)
    packet.set(ciBytes, header.length)
    this.mqttSocket.send({ data: packet.buffer })
  },

  _onConnected() {
    if (this.myRoom) {
      this.mqttSubscribe('tapbuzz/' + this.myRoom)
      this.pendingPing = true
    } else {
      this.myRoom = Math.random().toString(36).slice(2, 8).toUpperCase()
      this.mqttSubscribe('tapbuzz/' + this.myRoom)
      this.setData({
        pageMode: 'created',
        roomCode: this.myRoom,
        hint: '分享给好友，即可互振'
      })
    }
  },

  mqttSubscribe(topic) {
    if (!this.mqttSocket) return
    const topicBytes = []
    for (let i = 0; i < topic.length; i++) topicBytes.push(topic.charCodeAt(i))
    const packetId = 1
    const remainingLen = 2 + 2 + topicBytes.length + 1
    const header = [0x82, remainingLen]
    header.push((packetId >> 8) & 0xFF, packetId & 0xFF)
    header.push((topic.length >> 8) & 0xFF, topic.length & 0xFF)
    header.push(...topicBytes, 0)
    this.mqttSocket.send({ data: new Uint8Array(header).buffer })
  },

  mqttPublish(room, payload) {
    if (!this.mqttSocket) return
    const topic = 'tapbuzz/' + room
    const topicBytes = []
    for (let i = 0; i < topic.length; i++) topicBytes.push(topic.charCodeAt(i))
    const payloadBytes = []
    for (let i = 0; i < payload.length; i++) payloadBytes.push(payload.charCodeAt(i))
    const remainingLen = 2 + topicBytes.length + payloadBytes.length
    const header = [0x30, remainingLen]
    header.push((topic.length >> 8) & 0xFF, topic.length & 0xFF)
    header.push(...topicBytes, ...payloadBytes)
    this.mqttSocket.send({ data: new Uint8Array(header).buffer })
  },

  // ========== 分享 ==========
  onShareAppMessage() {
    return {
      title: '快戳我一下！',
      path: '/pages/index/index?room=' + this.myRoom
    }
  },

  // ========== 振动 ==========
  sendBuzz() {
    if (!this.isPaired) return
    this.mqttPublish(this.myRoom, 'buzz')
    this.setData({ btnIcon: '✓', btnLabel: '已发送' })
    setTimeout(() => this.setData({ btnIcon: '👆', btnLabel: '戳我' }), 400)
  },

  receiveBuzz() {
    if (!this.isPaired) {
      this.pendingBuzz = true
      return
    }
    this.doEffect()
  },

  doEffect() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    this.setData({ btnIcon: '💥', btnLabel: '嗡嗡嗡', _receiving: true })
    setTimeout(() => {
      this.setData({ btnIcon: '👆', btnLabel: '戳我', _receiving: false })
    }, 900)
  },

  // ========== 聊天 ==========
  toggleChat() {
    const show = !this.data.chatShow
    this.setData({
      chatShow: show,
      chatUnread: 0
    })
    if (show) {
      this._scrollToBottom()
    }
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  sendChat() {
    const text = this.data.chatInput.trim()
    if (!text || !this.isPaired) return

    this.mqttPublish(this.myRoom, 'msg:' + text)

    const msgs = this.data.chatMessages
    msgs.push({ text, from: 'me', time: this._now() })
    this.setData({
      chatMessages: msgs,
      chatInput: ''
    })
    this._scrollToBottom()
  },

  _receiveChat(text) {
    const msgs = this.data.chatMessages
    msgs.push({ text, from: 'other', time: this._now() })

    const update = { chatMessages: msgs }
    if (!this.data.chatShow) {
      update.chatUnread = this.data.chatUnread + 1
    }
    this.setData(update)
    if (this.data.chatShow) {
      this._scrollToBottom()
    }
  },

  _now() {
    const d = new Date()
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  },

  _scrollToBottom() {
    // 延迟等渲染完成
    setTimeout(() => {
      wx.pageScrollTo({ scrollTop: 99999 })
    }, 100)
  }
})
