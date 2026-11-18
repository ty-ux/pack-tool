import { Card, Input } from 'antd'
import { useConfig } from '../store/config'
import { BrowseInput } from './BrowseInput'
import { Field, FieldRow } from './Field'

export function WechatBuildSettings() {
  const { config, setField } = useConfig()
  if (!config) return null
  const { wechat } = config

  return (
    <Card title="微信小程序配置">
      <FieldRow>
        <Field label="微信小程序 AppID" hint="留空时读取小程序项目配置中的 AppID">
          <Input
            name="wechat-appid"
            value={wechat.appid}
            onChange={(e) => setField(['wechat', 'appid'], e.target.value)}
            maxLength={18}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <Field label="开发版本号" hint="上传开发版本和编译原生小程序时使用">
          <Input
            name="wechat-version"
            value={wechat.version}
            onChange={(e) => setField(['wechat', 'version'], e.target.value)}
            spellCheck={false}
          />
        </Field>
      </FieldRow>
      <Field label="代码上传密钥" hint="选择微信公众平台下载的密钥文件，存放于项目目录之外。PackTool 仅保存文件路径">
        <BrowseInput
          kind="file"
          title="选择微信小程序代码上传密钥"
          fileFilter="微信代码上传密钥 (*.key;*.pem)|*.key;*.pem|所有文件 (*.*)|*.*"
          value={wechat.privateKeyPath}
          onChange={(path) => setField(['wechat', 'privateKeyPath'], path)}
        />
      </Field>
      <Field label="版本说明" hint="可选，预览和上传时使用">
        <Input.TextArea
          name="wechat-description"
          value={wechat.description}
          onChange={(e) => setField(['wechat', 'description'], e.target.value)}
          rows={2}
        />
      </Field>
      <p className="field-hint">
        使用微信 CI 需在本机执行 <code>npm install -g miniprogram-ci</code>。原生小程序编译、扫码预览和上传均需配置 AppID 和密钥。启用 IP 白名单时，请在微信公众平台放行本机出口 IP。
      </p>
    </Card>
  )
}
