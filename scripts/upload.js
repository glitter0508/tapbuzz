/**
 * TapBuzz 微信小程序上传脚本
 * 使用 miniprogram-ci 自动化上传
 *
 * 使用前准备：
 * 1. 登录微信公众平台 https://mp.weixin.qq.com
 * 2. 进入 开发 → 开发设置 → 小程序代码上传 → 生成上传密钥
 * 3. 下载 private.key 放到项目根目录
 *
 * 运行：node scripts/upload.js
 */

const ci = require('miniprogram-ci')
const path = require('path')
const fs = require('fs')

const APPID = 'wxf15e0a9121bb615f'
const PROJECT_PATH = path.resolve(__dirname, '..', 'wechat-app')
const PRIVATE_KEY_PATH = path.resolve(__dirname, '..', 'private.key')

async function main() {
  // 检查私钥文件
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('❌ 未找到 private.key 文件！')
    console.error('请先在微信公众平台生成上传密钥，然后放到项目根目录')
    console.error('路径：', PRIVATE_KEY_PATH)
    process.exit(1)
  }

  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8')

  // 创建项目实例
  const project = new ci.CIProject({
    appid: APPID,
    type: 'miniProgram',
    projectPath: PROJECT_PATH,
    privateKey: privateKey,
    ignores: ['node_modules', 'package-lock.json']
  })

  // 上传
  const result = await ci.upload({
    project,
    version: '1.4.0',
    desc: '修复互震无效，配对后分享界面消失，聊天按钮位置调整',
    setting: {
      es6: true,
      minify: true,
      autoPrefixWXSS: true
    },
    onProgressUpdate: (info) => {
      if (info.status === 'done') return
      console.log(`[${info.status}] ${info.message || ''}`)
    }
  })

  console.log('✅ 上传成功！')
  console.log('请在微信公众平台提交审核：')
  console.log('https://mp.weixin.qq.com → 管理 → 版本管理 → 提交审核')
}

main().catch(err => {
  console.error('❌ 上传失败：', err.message || err)
  process.exit(1)
})
