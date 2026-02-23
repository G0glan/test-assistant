module.exports = {
  appId: "com.desktop.agent",
  productName: "Desktop Agent",
  directories: {
    output: "release"
  },
  files: ["dist/**/*", "package.json"],
  win: {
    target: "nsis"
  },
  mac: {
    target: "dmg"
  },
  linux: {
    target: "AppImage"
  }
};
