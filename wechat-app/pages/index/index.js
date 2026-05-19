// ========== 配置 ==========
// 部署 WebSocket 服务器后，把下面的地址替换成你的服务器地址
const WS_SERVER = '你的服务器地址.com/ws'
// 例如: const WS_SERVER = 'tapbuzz-production.up.railway.app/ws'

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

  // 内部变量
  socketTask: null,
  socketOpen: false,
  myRoom: '',
  isPaired: false,
  pendingBuzz: false,

  onLoad() {
    this.connectSocket()
  },

  // ========== WebSocket ==========
  connectSocket() {
    wx.showLoading({ title: '连接中...', mask: true })

    const url = WS_SERVER.startsWith('http')
      ? WS_SERVER.replace(/^http/, 'ws')
      : 'wss://' + WS_SERVER

    this.socketTask = wx.connectSocket({ url })
    const self = this

    this.socketTask.onOpen(() => {
      self.socketOpen = true
      wx.hideLoading()
      self.setData({ statusText: '已连接，创建或加入房间', connected: true })
    })

    this.socketTask.onMessage((res) => {
      const msg = JSON.parse(res.data)

      if (msg.type === 'joined') {
        self.myRoom = msg.roomId
        self.setData({ roomId: msg.roomId })
      }

      else if (msg.type === 'paired') {
        self.isPaired = true
        self.setData({ paired: true, hint: '点击按钮，对方就有反应' })
        if (self.pendingBuzz) {
          self.pendingBuzz = false
          self.doEffect()
        }
      }

      else if (msg.type === 'buzz') {
        self.receiveBuzz()
      }

      else if (msg.type === 'error') {
        wx.showToast({ title: msg.message || '错误', icon: 'error' })
      }
    })

    this.socketTask.onClose(() => {
      self.socketOpen = false
      self.isPaired = false
      self.setData({ connected: false, paired: false, statusText: '连接断开' })
      setTimeout(() => self.connectSocket(), 2000)
    })

    this.socketTask.onError(() => {
      wx.hideLoading()
      self.setData({ statusText: '连接失败，请检查网络' })
    })
  },

  send(data) {
    if (this.socketOpen && this.socketTask) {
      this.socketTask.send({ data: JSON.stringify(data) })
    }
  },

  // ========== 房间管理 ==========
  createRoom() {
    this.send({ type: 'create' })
    wx.showLoading({ title: '创建中...', mask: true })
    this.setData({ hint: '创建房间中' })
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
    this.send({ type: 'join', roomId: id })
    wx.showLoading({ title: '加入中...', mask: true })
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
    this.setData({
      connected: false, paired: false, roomId: '', hint: '',
      btnIcon: '👆', btnLabel: '戳我', statusText: '已退出'
    })
    if (this.socketTask) this.socketTask.close()
    setTimeout(() => this.connectSocket(), 500)
  },

  // ========== 振動 ==========
  sendBuzz() {
    if (!this.isPaired) return
    this.send({ type: 'buzz', roomId: this.myRoom })
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
    try { wx.vibrateShort({ type: 'medium' }) } catch(e) {}

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
