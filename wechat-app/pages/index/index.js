// ========== MQTT 直连（无需后端服务器） ==========
// 使用 EMQX 公共 MQTT 代理，通过 WebSocket 连接
// Mini Program 需要先配置 ws://broker.emqx.io:8083 到白名单
// 小程序管理后台 → 开发 → 开发设置 → 服务器域名 → socket 合法域名

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'

Page({
  data: {
    // 页面状态
    connected: false,
    paired: false,
    statusText: '初始化中...',
    roomId: '',
    roomInput: '',
    btnIcon: '👆',
    btnLabel: '戳我',
    hint: '',
    _receiving: false
  },

  // ========== MQTT 客户端状态 ==========
  mqttSocket: null,     // SocketTask
  mqttConnected: false,
  myRoom: '',
  isPaired: false,
  pendingBuzz: false,
  readerPos: 0,         // MQTT 协议读取位置

  onLoad() {
    this.connectMqtt()
  },

  // ========== MQTT 连接（纯 WebSocket，无第三方依赖） ==========
  connectMqtt() {
    wx.showLoading({ title: '连接中...', mask: true })
    this.readerPos = 0

    const url = BROKER_URL  // wss://broker.emqx.io:8084/mqtt
    this.mqttSocket = wx.connectSocket({ url })

    const self = this
    let connectTimer = null

    this.mqttSocket.onOpen(() => {
      // 发送 MQTT CONNECT 包
      // 固定头: 0x10 (CONNECT) + 剩余长度
      // 可变头: 协议名 "MQTT" + 协议级别 4 + 连接标志 + keepalive
      const clientId = 'tapbuzz_' + Math.random().toString(36).slice(2, 10)
      const protocolName = 'MQTT'
      const protocolLevel = 4
      const connectFlags = 2  // Clean Session
      const keepAlive = 60    // 60秒
      const protocolNameLen = protocolName.length

      // 构建 CONNECT 包
      const header = new Uint8Array([
        0x10, // CONNECT 固定头
        0,    // 剩余长度（占位）
        0, protocolNameLen, // 协议名长度
        77, 81, 84, 84, // MQTT
        protocolLevel,
        connectFlags,
        keepAlive >> 8, keepAlive & 0xFF
      ])
      // 剩余长度 = 可变头(10) + clientId长度(2+len)
      const remLen = 10 + 2 + clientId.length
      header[1] = remLen

      // 编码 clientId
      const clientIdBytes = new Uint8Array(2 + clientId.length)
      clientIdBytes[0] = (clientId.length >> 8) & 0xFF
      clientIdBytes[1] = clientId.length & 0xFF
      for (let i = 0; i < clientId.length; i++) {
        clientIdBytes[2 + i] = clientId.charCodeAt(i)
      }

      const packet = new Uint8Array(header.length + clientIdBytes.length)
      packet.set(header, 0)
      packet.set(clientIdBytes, header.length)

      self.mqttSocket.send({ data: packet.buffer })

      // 等待 CONNACK
      connectTimer = setTimeout(() => {
        wx.showToast({ title: 'MQTT 连接超时', icon: 'error' })
      }, 5000)
    })

    // MQTT 数据接收缓冲区
    let buffer = new Uint8Array(0)

    this.mqttSocket.onMessage((res) => {
      // res.data 可能是 ArrayBuffer
      let data = res.data
      if (typeof data === 'string') {
        // 文本消息（不太可能出现在 MQTT 中）
        return
      }

      // 如果是 ArrayBuffer，转为 Uint8Array
      if (data instanceof ArrayBuffer) {
        data = new Uint8Array(data)
      }

      // 追加到缓冲区
      const newBuf = new Uint8Array(buffer.length + data.length)
      newBuf.set(buffer, 0)
      newBuf.set(data, buffer.length)
      buffer = newBuf

      // 解析 MQTT 包
      while (buffer.length > 0) {
        const packetType = buffer[0] >> 4
        let remainingLen = 0
        let multiplier = 1
        let pos = 1
        // 解析剩余长度（可变长编码）
        while (pos < buffer.length) {
          const digit = buffer[pos]
          remainingLen += (digit & 127) * multiplier
          multiplier *= 128
          pos++
          if ((digit & 128) === 0) break
        }
        const totalLen = pos + remainingLen
        if (buffer.length < totalLen) break // 不完整的包

        // 处理 CONNACK (0x20)
        if (packetType === 2) {
          clearTimeout(connectTimer)
          wx.hideLoading()
          self.mqttConnected = true
          self.setData({
            statusText: '已连接，创建或加入房间',
            connected: true
          })
        }

        // 处理 PUBLISH (0x30)
        if (packetType === 3) {
          const pubPos = pos
          // 解析 topic
          const topicLen = (buffer[pubPos] << 8) | buffer[pubPos + 1]
          const topicStart = pubPos + 2
          let topic = ''
          for (let i = 0; i < topicLen; i++) {
            topic += String.fromCharCode(buffer[topicStart + i])
          }
          // 读取 payload
          const payloadStart = topicStart + topicLen
          let payload = ''
          for (let i = payloadStart; i < totalLen; i++) {
            payload += String.fromCharCode(buffer[i])
          }

          // 检查是否为 tapbuzz 话题
          const prefix = 'tapbuzz/'
          if (topic.startsWith(prefix) && payload === 'buzz') {
            self.receiveBuzz()
          } else if (topic.startsWith(prefix) && payload === 'ping') {
            // 对方加入了，标记配对
            if (!self.isPaired) {
              self.isPaired = true
              self.setData({
                paired: true,
                hint: '点击按钮，对方就有反应'
              })
            }
          }
        }

        // 处理 SUBACK (0x90)
        if (packetType === 9) {
          // 订阅确认 - 可以开始通信
          if (!self.isPaired) {
            // 发 ping 告知对方
            self.mqttPublish(self.myRoom, 'ping')
          }
        }

        // 移除已处理的包
        buffer = buffer.slice(totalLen)
      }
    })

    this.mqttSocket.onClose(() => {
      self.mqttConnected = false
      self.isPaired = false
      self.setData({ connected: false, paired: false, statusText: '连接断开' })
      setTimeout(() => self.connectMqtt(), 2000)
    })

    this.mqttSocket.onError(() => {
      clearTimeout(connectTimer)
      wx.hideLoading()
      self.setData({ statusText: '连接失败，请检查网络' })
    })
  },

  // MQTT Subscribe
  mqttSubscribe(topic) {
    if (!this.mqttSocket) return
    // SUBSCRIBE 包 (0x82)
    const topicBytes = []
    for (let i = 0; i < topic.length; i++) {
      topicBytes.push(topic.charCodeAt(i))
    }
    const packetId = 1
    const remainingLen = 2 + 2 + topicBytes.length + 1
    const header = [0x82, remainingLen, (packetId >> 8) & 0xFF, packetId & 0xFF]
    header.push((topic.length >> 8) & 0xFF, topic.length & 0xFF)
    header.push(...topicBytes)
    header.push(0) // QoS 0

    this.mqttSocket.send({ data: new Uint8Array(header).buffer })
  },

  // MQTT Publish
  mqttPublish(topic, payload) {
    if (!this.mqttSocket) return
    const topicBytes = []
    for (let i = 0; i < topic.length; i++) {
      topicBytes.push(topic.charCodeAt(i))
    }
    const payloadBytes = []
    for (let i = 0; i < payload.length; i++) {
      payloadBytes.push(payload.charCodeAt(i))
    }
    const remainingLen = 2 + topicBytes.length + payloadBytes.length
    const header = [0x30, remainingLen]
    header.push((topic.length >> 8) & 0xFF, topic.length & 0xFF)
    header.push(...topicBytes)
    header.push(...payloadBytes)

    this.mqttSocket.send({ data: new Uint8Array(header).buffer })
  },

  // ========== 房间管理 ==========
  createRoom() {
    if (!this.mqttConnected) return
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase()
    this.myRoom = roomId
    // 订阅房间主题
    this.mqttSubscribe('tapbuzz/' + roomId)
    this.setData({
      roomId: roomId,
      hint: '将房间号发给对方'
    })
    wx.hideLoading()
  },

  onRoomInput(e) {
    this.setData({ roomInput: e.detail.value })
  },

  joinRoom() {
    const id = this.data.roomInput.trim().toUpperCase()
    if (!id) {
      wx.showToast({ title: '请输入房间号', icon: 'none' })
      return
    }
    if (!this.mqttConnected) {
      wx.showToast({ title: '未连接', icon: 'error' })
      return
    }
    this.myRoom = id
    this.mqttSubscribe('tapbuzz/' + id)
    // 发 ping 通知对方
    this.mqttPublish(id, 'ping')
    this.setData({
      roomId: id,
      hint: '已加入房间'
    })
    wx.hideLoading()
  },

  onShare() {
    wx.setClipboardData({
      data: this.data.roomId,
      success: () => wx.showToast({ title: '已复制房间号', icon: 'success' })
    })
  },

  leaveRoom() {
    this.myRoom = ''
    this.isPaired = false
    this.mqttConnected = false
    this.setData({
      connected: false, paired: false, roomId: '', hint: '',
      btnIcon: '👆', btnLabel: '戳我', statusText: '已退出'
    })
    if (this.mqttSocket) this.mqttSocket.close()
    setTimeout(() => this.connectMqtt(), 500)
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
    // 物理振动
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}

    // 按钮动画
    this.setData({ btnIcon: '💥', btnLabel: '嗡嗡嗡', _receiving: true })
    setTimeout(() => {
      this.setData({ btnIcon: '👆', btnLabel: '戳我', _receiving: false })
    }, 900)
  },

  // ========== 分享 ==========
  onShareAppMessage() {
    return { title: '来戳我一下！', path: '/pages/index/index?room=' + this.myRoom }
  }
})
