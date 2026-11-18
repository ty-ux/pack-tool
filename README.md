# uni-app 打包控制台

> uni-app + HBuilderX 一键打包工具（本地网页图形界面），支持 **Android APK 离线打包**、**Web/H5 发行** 与 **WGT 热更新包**
>
> 后端：Python FastAPI（本地服务） · 前端：React 18 + TypeScript + Ant Design（Vite 构建）

工具在 Windows 本机运行。事先安装 Python 3.10+、Node.js LTS 和 HBuilderX，并准备自己的 uni-app 项目。Web/H5 和 WGT 不需要 Android 离线工程。

## 功能

- **网页图形界面**：浏览器操作，可视化配置
- **可配置项**：
  - App 名称、图标、包名、版本号
  - 权限（勾选：相机/扫码/联网/存储/安装APK 等 17 项）
  - 路径（HBuilderX CLI、uni-app 项目目录、离线工程目录、JDK、adb、输出目录、Web 输出目录）——**支持"浏览…"按钮弹系统选择框**
  - Android 签名（每个应用可选择自己的签名文件和密钥别名）
- **打包目标**（一键切换）：
  - `Android APK`：HBuilderX 编译 appResource → 同步资源 → Gradle 离线打包
  - `网站-PC Web` / `手机H5`：利用 HBuilderX 发行能力（`cli publish web`）生成 Web 产物
  - `WGT 热更新包`：利用 HBuilderX 制作应用资源升级包（`cli publish app --type wgt`），可配合升级中心做 App 热更新
- **Web 发行配置**：网站标题(webTitle)、网站域名(webDomain)、SSR（Vue3）
- **可选安装**：APK 打包后自动安装到指定设备/模拟器（可勾选，也可不装）
- **构建流水线展示**：编译 → 同步 → 配置 → Gradle 四步实时状态条（Web / WGT 为两步），一目了然进行到哪一步
- **构建前检查**：APK 打包前只读扫描应用信息、路径、Android 工程、签名与权限，提前提示文件缺失、图标路径失效、targetSdk 低于 35、签名口令明文、allowBackup 开启等风险（`GET /api/preflight`）
- **多应用配置**：每个应用独立一套打包配置，侧边栏「当前应用」随时切换；新建应用沿用当前应用的 HBuilderX/离线工程/JDK/adb/输出目录与构建目标，AppID、包名、项目目录留空重填；切换前自动保存，切回去配置不会丢
- **构建历史**：每次构建自动落库（SQLite），记录时间/目标/结果/耗时/产物路径/完整配置快照/归档日志，可随时回看；默认保留最近 100 条，可手动清空
- **真实"停止构建"**：一键杀停整个构建进程树（powershell → gradle → java），不残留后台任务
- **产物目录**：未指定输出目录时，APK 保留在离线工程中，WGT 写到 `output/`，Web/H5 写到 `output/build/`
- **记住配置**：每个应用的配置各存一份（`config\apps`），下次打开自动恢复并停留在上次使用的应用

## 目录结构

```
uniapp-pack-tool\
├── start.bat             # 启动服务并打开浏览器，按需安装后端依赖
├── build-frontend.bat    # 首次使用或前端更新后执行（npm ci + build → web\dist）
├── requirements.txt      # 后端依赖（fastapi、uvicorn）
├── server\               # 本地后端服务（FastAPI）
│   ├── main.py           # 应用装配 + 启动入口
│   ├── config.py         # 配置读写
│   ├── adb.py            # adb 服务（设备列表/重启/连接）
│   ├── builder.py        # 构建编排（BuildManager：启动/取消/日志/历史落库）
│   ├── history.py        # 构建历史（SQLite + 日志归档 + 保留策略）
│   ├── browse.py         # 系统文件/文件夹选择框
│   ├── staticserve.py    # 前端静态资源服务（SPA）
│   └── routers\api.py    # API 路由
├── scripts\
│   ├── build_apk.ps1     # APK 打包脚本（编译→同步→manifest→gradle）
│   ├── build_web.ps1     # Web/H5 发行脚本（publish web → 复制到 output\build）
│   └── build_wgt.ps1     # WGT 热更新包脚本（publish app --type wgt → 复制到 output）
├── web\                  # React 前端源码（Vite 项目）
│   ├── src\              # 组件/页面/状态/hooks
│   ├── dist\             # 构建产物（后端直接提供）
│   └── package.json
├── config\
│   ├── apps\             # 每个应用一份配置（<应用ID>.json，切换应用互不影响）
│   ├── active_app.json   # 当前应用指针
│   ├── packages.json     # 依赖包清单（勾选状态）
│   └── pack_config.legacy.json  # 旧版单应用配置，首次启动已迁入 config\apps，仅作备份
├── data\
│   └── build_history.db  # 构建历史（SQLite）
├── logs\                 # 构建日志（build.log / compile.log / gradle.log / web_build.log / wgt_build.log / builds\归档）
└── output\               # 打包产物
    ├── *.apk             # APK 产物
    └── build\            # Web/H5 构建产物
```

## 快速开始

### 方式一：双击启动（推荐）
1. 克隆或解压仓库，首次使用双击 `build-frontend.bat` 生成 `web\dist`。更新前端源码后再执行一次。
2. 双击 `start.bat` 启动服务并打开浏览器 `http://127.0.0.1:8765/`。如果缺少后端依赖，脚本会先安装。

### 方式二：命令行启动
在仓库根目录打开 PowerShell。

```powershell
npm --prefix web ci
npm --prefix web run build
python -m pip install -r requirements.txt
python -m server
```

### 前端开发模式（可选）
```powershell
cd web
npm ci
npm run dev        # http://localhost:5173，/api 自动代理到 8765
```

### 界面操作
1. 在 **打包构建** 页选择目标：Android APK、网站-PC Web、手机 H5 或 WGT 热更新包。
2. **应用信息**填写应用名称、版本和项目 `manifest.json` 中的 AppID。APK 还需填写 Android 包名。
3. **路径配置**选择 HBuilderX 安装目录下的 `cli.exe`、含 `manifest.json` 的项目目录。启动 HBuilderX，再保存配置。
4. 点 **一键打包**，终端面板实时显示日志；构建中点 **停止构建** 可强制终止
5. 在构建日志中查看最终产物路径。APK 构建可选用 adb 安装到已连接的设备。

### Android 离线打包准备

1. 按 [DCloud Android 离线开发文档](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/android) 自行获取与 HBuilderX 匹配的离线 SDK，并配置 Android SDK、JDK 和 [DCloud AppKey](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/appkey)。用 SDK 自带的 `HBuilder-Integrate-AS` 工程副本进行打包。
2. 在「路径配置」填写离线工程根目录，其中应有 `gradlew.bat` 和 `simpleDemo`。
3. 在「依赖包」页查看当前启用的文件名，从自己下载的 SDK 或其他授权来源把对应 `.aar` / `.jar` 放入本工具的 `packages/`。额外插件可在界面上传。对照离线工程的实际依赖选择勾选项，再执行同步。
4. 在「打包构建」运行构建前检查，然后先试打 Debug APK。

APK 构建会替换离线工程中的应用资源，并修改 Manifest、Gradle 配置和应用图标。同步依赖时，取消勾选的托管依赖会从 `simpleDemo/libs` 移除。APK 和 WGT 构建还会把界面填写的版本号写回 uni-app 项目的 `manifest.json`。首次试用建议使用工程副本。

### 为每个应用选择 Android 签名

1. 切换到要打包的应用，打开「应用信息 → Android 签名」，选择本机的 `.jks` 或 `.keystore` 文件并填写密钥别名（Key Alias）。
2. 填写**环境变量名**，例如 `DEMO_STORE_PASSWORD`。如果密钥密码和密钥库密码不同，再填写单独的变量名，例如 `DEMO_KEY_PASSWORD`。每个应用可以使用不同的变量名。
3. 在运行打包工具的 Windows 用户下设置这些环境变量。已启动工具时，停止本地服务再重新启动，使服务读取新变量。
4. 保存配置并在「打包构建」运行构建前检查。所选密钥同时适用于该应用的 Debug 和 Release APK。留空签名文件时沿用离线工程的 Gradle 签名，旧应用配置可以继续使用。

也可以只为当前 PowerShell 会话设置密码，再从同一个窗口启动服务。下面的命令会提示输入，避免把密码写进命令历史。

```powershell
$env:DEMO_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host '密钥库密码' -AsSecureString)).Password
python -m server
```

打包工具只保存文件路径、别名和变量名，密码在构建时通过进程环境传给 Gradle。按应用签名需要支持 `finalizeDsl` 的 Android Gradle Plugin（AGP 7.2+）。签名文件及密码保存在本机。更换签名前请确认 DCloud 后台配置的 AppID、包名及证书 SHA-1 和实际 APK 一致。

## 打包流程（脚本内部）

### Android APK（build_apk.ps1）
```
1. HBuilderX CLI 编译前端资源 (appResource)
   → unpackage/resources/__UNI__XXXX/www
   （校验：产物必须为本次新生成、含入口文件，杜绝拿旧/空资源打"假成功"包；
     兼容新旧 HBuilderX 产物入口 index.html / __uniappview.html）

2. 同步 www 到离线工程
   → HBuilder-Integrate-AS/simpleDemo/src/main/assets/apps/__UNI__XXXX/www

3. 更新 AndroidManifest.xml
   - 权限（根据勾选）
   - 相机特性
   - 包名
   + build.gradle（版本号/包名）
   + strings.xml（App名称）

4. Gradle 打包
   → simpleDemo/build/outputs/apk/release/simpleDemo-release.apk
   → 已配置 APK 输出目录时复制到该目录

5. (可选) adb 安装到设备 + 启动
```

### 网站-PC Web / 手机H5（build_web.ps1）
```
1. HBuilderX CLI 发行 (cli publish web)
   → 项目 unpackage/dist/build/web（校验本次新生成）
2. 复制产物（会先清空选定的 Web 输出目录，请使用专用目录）
   → output\build\（index.html + 静态资源）
```

### WGT 热更新包（build_wgt.ps1）
```
1. HBuilderX CLI 制作应用资源升级包 (cli publish app --type wgt)
   → 项目 unpackage/release\<AppID>.wgt（校验本次新生成）
2. 复制产物
   → output\<App名称>-v<版本号>.wgt
```
> 注意：wgt 只包含前端资源，App 端需集成升级中心（uni-upgrade-center）或调用 `plus.runtime.install` 才能完成热更新；改到原生层（原生插件/权限/manifest 配置）时仍需重打 APK 整包发版。每次发布前请在 manifest.json 中递增版本号。

## 依赖

| 依赖 | 说明 | 路径示例 |
|---|---|---|
| Python 3.10+ | 运行本地服务 | [Python](https://www.python.org/downloads/) |
| Node.js LTS | 构建控制台前端 | [Node.js](https://nodejs.org/) |
| HBuilderX | 提供 CLI，编译 uni-app 项目 | `C:\Tools\HBuilderX\cli.exe`（**打包前需启动**） |
| Android SDK | APK 打包所需，包含 build-tools | `C:\Android\Sdk` |
| JDK | 选择与离线工程 Gradle 版本兼容的 JDK | `C:\Java\jdk-17`，或使用系统 `JAVA_HOME` / `PATH` |
| adb | 可选，用于自动安装 | `C:\Android\Sdk\platform-tools\adb.exe` |
| Gradle | 通过离线工程的 gradlew wrapper | 无需单独安装 |

## 常见问题

**Q: 网页打不开？**
A: 确认已运行 `start.bat`（或 `python -m server`），访问 `http://127.0.0.1:8765/`。若提示"端口 8765 已被占用"，说明旧服务还在运行，可先关闭再启动。

**Q: 打开的是"前端尚未构建"引导页？**
A: 执行 `build-frontend.bat` 生成 `web\dist` 后刷新页面；开发时也可用 `npm run dev` 访问 5173。

**Q: 打包失败怎么办？**
A: 查看 `logs/compile.log`（编译）和 `logs/gradle.log`（打包）定位问题。常见原因：**HBuilderX 未启动**、路径配置错误、JDK 版本、签名错误。

**Q: 点"停止构建"后还有进程？**
A: 停止会强杀本工具发起的构建进程树；若此前 Web 发行与 HBuilderX 主程序通信，主程序内的编译动作可能仍在继续（`web` 产物有新鲜度校验兜底，不会被旧产物覆盖）。

**Q: 修改包名后旧 App 还在？**
A: 包名修改后是全新应用，需先卸载旧版。且后端若绑定了包名鉴权，需同步。

**Q: 图标怎么选？**
A: 点 **选择图标** 选文件，或点 **选择目录** 选按 dpi 组织的目录（例如包含 `drawable-xxhdpi\icon.png`）。构建时会按密度写入离线工程，缺少的密度用目录里分辨率最高的一张补齐。首次覆盖前原图标会备份到 `simpleDemo\.pack-tool\icon-backup\`。未选择图标时沿用离线工程的图标。若桌面图标没变，请确认 `AndroidManifest.xml` 的 `android:icon` 指向 `@drawable/icon`。

**Q: 怎么管理多个 App 的打包配置？**
A: 侧边栏顶部的「当前应用」可以切换、新建、删除应用。每个应用在 `config\apps\` 下各存一份完整配置；新建应用会沿用 HBuilderX、离线工程、JDK、adb、输出目录和构建目标，AppID / 包名 / 项目目录需要重新填写。切换时当前未保存的改动会自动保存，切回去不会丢。构建历史存的是当时的应用配置快照，与当前选中的应用无关。删除应用会删掉它的配置文件（构建历史保留），最后一个应用不能删。

**Q: 权限改了不生效？**
A: 权限写入的是离线工程的 `AndroidManifest.xml`，改后必须重新打包才生效（界面点"一键打包"即可）。

## 端口
- 后端默认 `8765`（改 `server\main.py` 的 `PORT`）；前端开发 `5173`

## 安全
- 服务仅绑定 `127.0.0.1`（本机），不会暴露到局域网
- 应用配置、依赖包、历史记录、日志和输出产物均为本地文件。分享故障日志前请检查其中的路径、应用信息和签名配置。

## 许可证

本仓库中的工具源码采用 [MIT License](LICENSE)。HBuilderX、DCloud Android 离线 SDK、第三方插件和库由各自的权利人提供，请从授权来源获取并按对应条款使用。

## 提交代码

每次修改都从最新的 `main` 新建分支。在分支上验证、提交和推送，再向 `main` 发起 Pull Request 并通过 GitHub 合并。仓库保护规则禁止直接推送到 `main`。
