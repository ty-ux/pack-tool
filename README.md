# PackTool

> Windows 本地打包控制台。支持原生 Android、Flutter 和 React Native 的 APK、AAB 构建，uni-app 的离线 APK、Web/H5 和 WGT，以及 uni-app 和原生微信小程序的构建、预览和上传开发版本。
>
> 后端：Python FastAPI（本地服务） · 前端：React 18 + TypeScript + Ant Design（Vite 构建）

选择工程类型后，PackTool 调用该项目的构建工具，并记录日志和产物路径。

| 工程类型 | 产物 | 本机依赖 |
| --- | --- | --- |
| 原生 Android | APK、AAB | 工程自带的 Gradle Wrapper、兼容的 JDK 和 Android SDK |
| Flutter | APK、AAB | Flutter SDK、Android SDK 和 Android SDK Command-line Tools |
| React Native | APK、AAB | 工程的 JavaScript 依赖、Node.js、`android/` 中的 Gradle Wrapper、兼容的 JDK 和 Android SDK |
| uni-app | APK、Web/H5、WGT、微信小程序 | HBuilderX 或提供微信构建脚本的 uni-app CLI 工程。离线 APK 额外需要 Android 离线工程、JDK 和 Android SDK |
| 原生微信小程序 | 编译 ZIP、预览二维码、上传开发版本 | Node.js、微信官方 `miniprogram-ci`、微信代码上传密钥 |

## 功能

- **图形界面**：在独立桌面窗口或浏览器中可视化配置
- **原生 Android、Flutter 与 React Native**：选择 Debug 或 Release 和可选的 Flavor，沿用工程的包名、版本和签名配置。原生 Android 和 React Native 可以指定 Gradle 模块。
- **Flutter 版本与签名**：在「应用信息」填写可选版本号和版本码，构建时传给 Flutter，留空时读取 `pubspec.yaml`。APK 和 AAB 均可选择本机签名文件、别名并直接填写密码。选用签名时使用 PackTool 独立 Gradle 缓存，首次构建需下载依赖，私有仓库的 Gradle 全局设置需配置到该缓存目录。
- **uni-app 配置**：
  - App 名称、图标、包名、版本号
  - 权限（勾选：相机/扫码/联网/存储/安装APK 等 17 项）
  - 路径（HBuilderX CLI、uni-app 项目目录、离线工程目录、JDK、adb、输出目录、Web 输出目录）——**支持"浏览…"按钮弹系统选择框**
  - Android 签名（每个应用可选择自己的签名文件和密钥别名）
- **uni-app 打包目标**：
  - `Android APK`：HBuilderX 编译 appResource → 同步资源 → Gradle 离线打包
  - `网站-PC Web` / `手机H5`：利用 HBuilderX 发行能力（`cli publish web`）生成 Web 产物
  - `WGT 热更新包`：利用 HBuilderX 制作应用资源升级包（`cli publish app --type wgt`），可配合升级中心做 App 热更新
  - `微信小程序`：通过项目的 `build:mp-weixin` 或 HBuilderX CLI 生成 `mp-weixin` 产物
- **Web 发行配置**：网站标题(webTitle)、网站域名(webDomain)、SSR（Vue3）
- **可选安装**：uni-app 的 APK 打包后可自动安装到指定设备或模拟器。
- **构建流水线**：实时显示当前阶段和构建日志。
- **构建前检查**：检查项目目录和构建命令。uni-app 还会扫描应用配置、签名和权限。
- **多应用配置**：每个应用独立保存工程类型、路径和构建选项，可以从侧边栏切换。
- **本机环境扫描**：从环境变量、`PATH` 和常见安装位置查找 JDK、Android SDK、Flutter CLI、adb、HBuilderX CLI、Node.js。在路径配置中可从下拉菜单选用，也可输入路径或浏览文件与文件夹。
- **构建历史**：每次构建自动落库（SQLite），记录时间/目标/结果/耗时/产物路径/完整配置快照/归档日志，可随时回看；默认保留最近 100 条，可手动清空
- **真实"停止构建"**：一键杀停整个构建进程树（powershell → gradle → java），不残留后台任务
- **产物目录**：原生 Android、Flutter 和 React Native 默认保留在项目构建目录，也可以指定导出目录。uni-app 默认将 APK 保留在离线工程，WGT 生成在 `output/`，Web/H5 生成在 `output/build/`。
- **记住配置**：每个应用的配置各存一份（`config\apps`），下次打开自动恢复并停留在上次使用的应用

## 微信小程序

1. 在「应用信息」选择工程类型。原生小程序在「路径配置」选择含 `project.config.json` 的目录，支持配置文件里的 `miniprogramRoot`。uni-app 在「打包构建」选择「微信小程序」目标。
2. uni-app 点击「编译小程序」生成产物。CLI 工程先安装项目依赖，产物默认在 `dist/build/mp-weixin`。HBuilderX 工程启动 HBuilderX 并导入项目，产物默认在 `unpackage/dist/build/mp-weixin`。预览和上传使用上次编译产物，源码修改后请重新编译。
3. 通过 `npm install -g miniprogram-ci` 安装[微信官方 CI](https://github.com/wechat-miniprogram/miniprogram-ci-dist)，也可以把它装在项目中。原生小程序编译 ZIP、扫码预览和上传需要连接微信服务。
4. 在「打包构建」选择微信公众平台下载的代码上传密钥。密钥存放在项目目录之外，每个 PackTool 应用独立保存文件路径。AppID 留空时读取 `project.config.json`。启用 IP 白名单时需放行本机出口 IP。
5. 「生成预览二维码」可直接在 PackTool 中扫码。「上传开发版本」使用填写的版本号和说明。提审和正式发布在微信公众平台操作。

## 目录结构

```
pack-tool\
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

### Windows x64 免安装版（推荐）

1. 从 [GitHub Releases](https://github.com/ty-ux/pack-tool/releases) 下载 `PackTool-win-x64.zip`。
2. 解压整个 ZIP，双击文件夹里的 `PackTool.exe`。发行包已包含 Electron 和 Python 运行环境，可以直接启动。
3. 新建应用，选择工程类型，在「路径配置」填写项目和工具路径。

应用配置、依赖包、日志、历史数据库和默认 Web/WGT 产物保存在 `%APPDATA%\PackTool\workspace`。更新时解压新版即可继续使用这些数据。依赖包放入该目录下的 `packages`，或在「依赖包」页上传。如果以前从源码运行，可以在桌面版退出时将原目录的 `config` 和 `packages` 复制到桌面版的数据目录。

### 选择本机工具

1. 打开「路径配置」，PackTool 会自动扫描。安装工具或调整环境变量后，也可点击「扫描本机环境」刷新候选路径。
2. 点击对应字段的「本机路径」，从候选项中选择需要的安装位置。字段仍支持直接输入路径或通过「浏览」选择。
3. 保存本应用的路径配置。选择的 Android SDK 会为构建子进程设置 `ANDROID_HOME` 和 `ANDROID_SDK_ROOT`，选择的 Node.js 会优先加入 React Native 构建的 `PATH`。项目 `local.properties` 的 `sdk.dir` 或 Flutter 自己保存的 Android SDK 配置可能优先生效。扫描和选择路径都不会修改系统环境变量。

### 从源码双击启动

此方式需要 Python 3.10+、Node.js LTS。

1. 克隆或解压仓库，首次使用双击 `build-frontend.bat` 生成 `web\dist`。更新前端源码后再执行一次。
2. 双击 `start.bat` 启动服务并打开浏览器 `http://127.0.0.1:8765/`。如果缺少后端依赖，脚本会先安装。

### 从源码命令行启动
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

### 构建 Windows 发行包

在 Windows x64 上准备 64 位 Node.js 24 和 Python 3.13，从仓库根目录执行。

```powershell
npm --prefix web ci
npm --prefix web run build
npm --prefix desktop ci
python -m pip install -r desktop/requirements-build.txt
npm --prefix desktop run package:windows
npm --prefix desktop run test:windows
```

ZIP 生成在 `desktop/out/PackTool-win-x64.zip`。GitHub Actions 在 PR 上构建并验证 ZIP。发布新版时，先在功能分支更新 `desktop/package.json` 和锁文件的版本，通过 PR 合并后，将对应的 `vX.Y.Z` 标签推送到 GitHub。构建通过后，工作流会把 ZIP 发布到 Releases。

### 打包原生 Android、Flutter 或 React Native

1. 新建应用时选择「原生 Android」「Flutter」或「React Native」。已有应用可以在「应用信息」修改类型。
2. 在「路径配置」选择项目根目录。
   - 原生 Android 项目应包含 `gradlew.bat`。
   - Flutter 项目应包含 `pubspec.yaml` 和 `android/`。Flutter CLI 可从 `PATH` 查找，也可选择 `bin/flutter.bat`。
   - React Native 项目应包含 `package.json` 和 `android/gradlew.bat`。用项目指定的包管理器安装依赖，在「路径配置」中选择 Node.js 目录，或从 `PATH` 使用 Node.js。
3. 在「打包构建」选择 APK 或 AAB，以及 Debug 或 Release。原生 Android 的模块默认是 `app`，可以改成实际模块名。项目配置了 Flavor 时，填写相应名称。
4. 运行构建前检查，再点「一键打包」。设置了输出目录时，PackTool 会把产物复制过去。留空时保存在工程的默认输出目录，可以从构建历史定位。

Release 使用项目自己的签名配置。在 Android 工程的 Gradle 配置中绑定生产密钥。Flutter 项目的 Android 签名配置在 `android/` 下。密钥文件和口令保存在本机。Flutter 的 Release AAB 构建还会调用 Android SDK Command-line Tools 中的 `apkanalyzer` 检查产物。 [Android 命令行构建](https://developer.android.com/build/building-cmdline?hl=zh-cn) · [Flutter Android 发行](https://docs.flutter.dev/deployment/android)

React Native 使用 `android/` 下的 Gradle 构建。Release 由 React Native Gradle 插件打包 JavaScript 和资源，通常可独立运行。Debug 包通常需要连接 Metro。使用 Expo 的项目可以在生成 Android 原生工程后走同一流程。 [React Native Android 发行](https://reactnative.dev/docs/signed-apk-android) · [React Native Gradle 插件](https://reactnative.dev/docs/react-native-gradle-plugin)

### 打包 uni-app
1. 在 **打包构建** 页选择目标：Android APK、网站-PC Web、手机 H5 或 WGT 热更新包。
2. **应用信息**填写应用名称、版本和项目 `manifest.json` 中的 AppID。APK 还需填写 Android 包名。
3. **路径配置**选择 HBuilderX 安装目录下的 `cli.exe`、含 `manifest.json` 的项目目录。启动 HBuilderX，再保存配置。
4. 点 **一键打包**，终端面板实时显示日志；构建中点 **停止构建** 可强制终止
5. 在构建日志中查看最终产物路径。APK 构建可选用 adb 安装到已连接的设备。

### Android 离线打包准备

1. 按 [DCloud Android 离线开发文档](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/android) 自行获取与 HBuilderX 匹配的离线 SDK，并配置 Android SDK、JDK 和 [DCloud AppKey](https://nativesupport.dcloud.net.cn/AppDocs/usesdk/appkey)。用 SDK 自带的 `HBuilder-Integrate-AS` 工程副本进行打包。
2. 在「路径配置」填写离线工程根目录，其中应有 `gradlew.bat` 和 `simpleDemo`。
3. 在「依赖包」页查看来源和启用状态。内置依赖会自动从已配置离线 SDK 的 `simpleDemo/libs` 恢复，无需重复手动复制；SDK 未提供的模块需从匹配该 SDK 的授权来源补齐。额外插件可在界面上传。对照离线工程的实际依赖选择勾选项，再执行同步。
4. 在「打包构建」运行构建前检查，然后先试打 Debug APK。

APK 构建会替换离线工程中的应用资源，并修改 Manifest、Gradle 配置和应用图标。同步依赖时，取消勾选的托管依赖会从 `simpleDemo/libs` 移除。APK 和 WGT 构建还会把界面填写的版本号写回 uni-app 项目的 `manifest.json`。首次试用建议使用工程副本。

### 密钥管理与应用签名

「密钥管理」集中保存签名文件路径、Key Alias 和密码配置，供 uni-app、Flutter、原生 Android 和 React Native 应用复用。已有应用单独填写的签名会自动导入并去重，原应用配置继续保留。

1. 打开「密钥管理」，新建或编辑密钥，填写名称、签名文件、别名和密码。可先点击「验证签名」检查实际证书和私钥。
2. 点击「保存密钥」。密码在本机按当前 Windows 账户加密保存，默认遮挡；点击「显示已保存密码」可查看，关闭显示或离开页面后会清除页面中的明文。
3. 切换到需要打包的应用，在「应用信息 → Android 签名 → 选择密钥」中选择共享密钥，保存应用配置。应用只记录密钥引用；更新共享密钥后，引用应用下次构建会使用新配置，已经启动的构建沿用启动时的配置。
4. 管理页会显示引用该密钥的应用。被引用的密钥不能删除；未引用密钥的删除仅移除配置，保留签名文件。

共享配置保存在本机 `config/signing_keys.json`，与应用配置一样被 Git 忽略。文件路径是本机路径，迁移到其他电脑时需要重新选择文件并填写密码。环境变量方式仍可使用。

### 为单个应用单独设置 Android 签名

1. 切换到要打包的应用，打开「应用信息 → Android 签名」，选择本机的 `.jks` 或 `.keystore` 文件并填写密钥别名（Key Alias）。
2. 默认选择「直接填写」，输入密钥库密码。密钥密码与密钥库密码相同时留空，不同时填写。
3. 保存配置。密码由 Windows DPAPI 按当前账户加密保存，各应用独立。再次打开时密码框为空，显示「已保存」；留空会保留原密码，填写新密码可替换，也可明确清除。更换电脑或 Windows 账户后需重新填写。
4. 点击「验证签名」，实际检查文件、别名和两个密码。可以验证尚未保存的输入，也可以直接使用已保存的密码；修改签名设置或切换应用后会清除旧验证结果。验证只读取签名文件，不改写证书，不保存配置或创建构建历史。需要完整的 JDK 11 或更高版本，优先使用「路径配置」选择的 JDK。
5. 在「打包构建」运行构建前检查。所选密钥适用于该应用的 Debug 和 Release，Flutter、原生 Android 和 React Native 支持 APK 和 AAB。留空签名文件时沿用工程的 Gradle 签名。

需要沿用已有环境变量时，选择「环境变量（高级）」，填写变量名，例如 `DEMO_STORE_PASSWORD`；密钥密码不同时再填写 `DEMO_KEY_PASSWORD`。在运行工具的 Windows 用户下设置变量后重新启动工具。已配置且能读取密码变量的旧应用会保留此方式。本机加密保存目前支持 Windows，其他系统可使用环境变量。

也可以只为当前 PowerShell 会话设置密码，再从同一个窗口启动服务。下面的命令会提示输入，避免把密码写进命令历史。

```powershell
$env:DEMO_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host '密钥库密码' -AsSecureString)).Password
python -m server
```

密码在构建时解密并通过子进程环境传给 Gradle，运行配置和构建历史不保存密码或加密密码副本。按应用签名需要支持 `finalizeDsl` 的 Android Gradle Plugin（AGP 7.2+）。签名文件及密码保存在本机。更换 uni-app 签名前请确认 DCloud 后台配置的 AppID、包名及证书 SHA-1 和实际 APK 一致。

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

**Q: 升级新版会覆盖旧配置和日志吗？**
A: 桌面版的程序文件与用户数据分离，仍使用 `%APPDATA%\PackTool\workspace`，版本号和解压位置不会改变该目录。先退出旧版，再解压运行新版。新版在第一次打开既有数据、或版本变化时，将 `config`、`packages`、`logs`、`data`、`output` 和 `icon` 备份到用户数据目录的 `backups/PackTool-*.zip`，备份成功后才继续启动。SQLite 历史使用数据库快照 API，包含已提交的 WAL 数据；备份失败则停止启动，原始数据保留。程序不自动清理这些备份，请按磁盘空间自行保留。

「数据与外观」显示实际数据位置，并提供手动备份和打开目录。配置与依赖清单采用临时文件写入后原子替换，写入失败不会截断旧文件。本机备份可能包含敏感配置，仅用于本机恢复；恢复前退出程序并另外备份现有目录，再从 ZIP 中还原所需目录。备份不包括工作区之外的项目、证书或 SDK，也不包括可重新生成的 Gradle 缓存（caches、wrapper、daemon 等）；Gradle 的 gradle.properties、init.d 和其他用户设置仍保留在备份中。

**Q: 换电脑怎样导入配置？**
A: 在旧电脑的「数据与外观」点击「导出全部应用配置」，将 JSON 复制到新电脑，再选择该文件预览并确认导入。导入为新的应用，不覆盖已有应用，不切换当前应用，也不替换全局依赖清单、日志或历史。共享签名引用会展开为独立签名设置；密码及绑定 Windows 用户的加密凭据不会导出，在新电脑重新填写。导出不含证书、图标、项目和依赖二进制文件，这些文件需要另外复制。导入预览会提示当前电脑缺失的路径；导入后仍需在「路径配置」核对工具、项目和产物目录，并重新设置密码或环境变量。文件格式带版本号，未来格式和非法字段会在写入前拒绝。

**Q: 如何切换明亮或黑暗模式？**
A: 使用页头「外观」或「数据与外观」中的主题选择，支持明亮、黑暗和跟随系统。设置保存在用户数据目录的 `config/preferences.json`，桌面版端口变化或重新启动不会丢失。默认跟随系统，系统主题变化时同步更新。

**Q: 同步依赖包失败，或旧版本提示「请求失败 (200)」？**
A: HTTP 200 仅表示请求已返回，同步仍可能因离线工程目录未配置、源文件缺失或写入权限不足失败。新版在依赖包页显示实际原因及逐包结果。先在「路径配置」填写离线工程根目录（包含 `simpleDemo` 的目录），再执行同步。

若源码目录已有依赖包而桌面版仍提示缺失，请检查 `%APPDATA%\PackTool\workspace\packages`。两个运行方式使用不同的数据目录。内置依赖缺少源文件时，同步会自动从当前离线 SDK 的 `simpleDemo/libs` 恢复到用户 `packages`，沿用所选 SDK 的版本，不覆盖已有用户源文件；取消勾选时也会先保存 SDK 中的源文件再移除工程依赖。X5 两个可选模块在新清单中默认关闭，已保存的勾选状态保持不变。SDK 和用户目录都缺失的已启用依赖仍会明确报错，可选模块可取消勾选；自定义插件仍需上传源文件。依赖页显示每个文件的来源。

**Q: 如何查看全局操作日志、提交问题？**
A: 所有页面的后台请求都会记录到用户数据目录的 `logs/application.log`，包含版本、时间、请求编号、方法、路由、耗时和操作结果（包括 HTTP 200 的业务失败），并记录构建启动、进程退出、取消、历史落库异常、升级备份和服务生命周期。页面切换、前端校验失败与未处理异常也会记录；前端异常记录类型和脚本位置，不收集表单值或原始异常消息。失败请求显示日志编号，可据此查找同次操作。日志自动追加，单文件上限 5 MiB，保留当前文件及 5 份轮转；请求正文、响应正文、查询参数和认证头不写入日志。

在「数据与外观 → 全局操作日志」可打开日志目录，或「导出诊断日志」。ZIP 汇总全局日志、依赖同步日志、启动日志、当前构建及最近 10 份构建归档；每个文件最多导出末尾 1 MiB，`diagnostics.json` 标记截断和不可用文件。不包含配置、数据库、证书或依赖文件，并对常见密码、Token、本机加密凭据标记脱敏。第三方构建输出仍可能包含本机路径和其他个人内容，提交 issue 前请检查。日志仅保存在本机，不自动上传。

桌面版启动日志位于 `%APPDATA%\PackTool\logs\startup.log`，记录版本、升级备份阶段、后端错误和就绪结果；达到 2 MiB 时在下次启动轮转为 `.1`。启动失败弹窗会显示日志位置。升级备份期间会持续报告存活状态，避免仍在正常备份时被 30 秒等待误判；最长等待 15 分钟。

依赖包页可「下载同步日志」附到 issue。日志保存在用户数据目录的 `logs/packages-sync.log`，包含工具版本、每次同步标识、时间、源/目标路径、逐包结果和异常堆栈，不记录配置正文或签名密码。单文件上限 2 MiB，保留 3 份轮转备份（`.1` 至 `.3`，可在本机查看）；下载入口提供当前日志文件。桌面版用户数据目录为 `%APPDATA%\PackTool\workspace`，源码版默认为仓库根目录，也可通过 `PACK_TOOL_DATA_DIR` 指定。提交前请检查日志中的个人路径和文件名。

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
A: 侧边栏顶部的「当前应用」可以切换、新建、删除应用。每个应用在 `config/apps/` 下各存一份配置。新建应用会沿用已填写的工具路径。项目目录需要重新选择，原生 Android、Flutter 和 React Native 的导出目录也按应用设置。切换应用时会保存当前改动。删除应用时会保留构建历史，至少需要保留一个应用。

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
