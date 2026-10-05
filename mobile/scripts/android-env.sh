#!/usr/bin/env bash
# 构建 Android 用的环境：Capacitor 8 需要 JDK 21，只在这里临时指定，不改全局 JAVA_HOME。
# 用法：source scripts/android-env.sh
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
# 本机经代理上网时，Gradle 的 JVM 也要走代理（读 http_proxy 环境变量）
if [ -n "${https_proxy:-}" ]; then
  _h="${https_proxy#*://}"; _host="${_h%%:*}"; _port="${_h##*:}"; _port="${_port%%/*}"
  export JAVA_TOOL_OPTIONS="-Dhttp.proxyHost=$_host -Dhttp.proxyPort=$_port -Dhttps.proxyHost=$_host -Dhttps.proxyPort=$_port -Dhttp.nonProxyHosts=localhost|127.0.0.1"
fi
