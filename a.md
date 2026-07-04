git submodule add <子仓库的URL> <存放路径>
git submodule add git@codeup.aliyun.com:69a6db102baf901da4b6bff2/exteral-lib/libcli.git mf/libcli
git submodule add git@codeup.aliyun.com:69a6db102baf901da4b6bff2/exteral-lib/netopeer2.git mf/netopeer2
git submodule add git@codeup.aliyun.com:69a6db102baf901da4b6bff2/exteral-lib/sysrepo.git mf/sysrepo
git submodule add git@codeup.aliyun.com:69a6db102baf901da4b6bff2/exteral-lib/libyang.git mf/libyang
git submodule add git@codeup.aliyun.com:69a6db102baf901da4b6bff2/exteral-lib/libnetconf2.git mf/libnetconf2
git submodule add git@codeup.aliyun.com:69a6db102baf901da4b6bff2/exteral-lib/libmf.git mf/libmf





# 方式 1：构建脚本（推荐，增量/单项目构建）
cd mf && ./build.sh          # 全量 Release 构建
./build.sh debug             # Debug 构建
./build.sh libyang           # 仅构建 libyang
./build.sh clean             # 清理

# 方式 2：VSCode 任务
# Ctrl+Shift+B → 选择 "Build: All (Release)" 或单个项目

# 方式 3：CMake
cd mf && mkdir build && cd build
cmake .. -DCMAKE_INSTALL_PREFIX=$(pwd)/install
make -j$(nproc)


# 1. 将 /mnt/flash 及其子目录的所有者彻底变更为 developer 用户
sudo chown -R developer:developer /mnt/flash

# 2. 赋予该目录完全读写权限
chmod -R 777 /mnt/flash

./build.sh


```
git clone --recursive https://github.com/lvhuanid/7_t.git
```

```
git submodule foreach --recursive 'git fetch --tags && git checkout v1.0.0'
```



场景 B：项目已经 Clone 到了本地，现在想拉取最新的子模块
如果你本地已经有这个项目，但子模块目录目前是空的，或者你想把它们更新到 .gitmodules 中指定的 v1.0.0 分支，请依次执行以下命令：
# 1. 先把主仓库的代码拉取到最新
```
git pull origin main  # (注: 如果主分支叫 master 请改为 master)
```
# 2. 同步你在 .gitmodules 中修改的分支配置
```
git submodule sync
```

# 3. 递归初始化并根据配置的 branch (v1.0.0) 抓取远程代码
```
git submodule update --init --recursive --remote
```





添加
# 语法：git submodule add <仓库URL> <本地存放路径>
```
git submodule add https://github.com/lvhuanid/CLI11.git mmmmfc11/CLI11
```
提交
```
# 1. 查看状态，你会发现多了 .gitmodules 和 mmmmfc11/CLI11 两个变更
git status

# 2. 暂存变更
git add .gitmodules mmmmfc11/CLI11

# 3. 提交到本地仓库
git commit -m "feat: add CLI11 submodule"

# 4. 推送到远程
git push origin main
```

转换tag
```
# 1. 正常添加
git submodule add https://github.com/lvhuanid/CLI11.git mmmmfc11/CLI11

# 2. 进入子模块目录去切换 Tag
cd mmmmfc11/CLI11
git fetch --tags
git checkout v1.0.0

# 3. 回到主仓库目录并提交最新的指针状态
cd ../..
git add mmmmfc11/CLI11
git commit -m "feat: add CLI11 submodule and pin to tag v1.0.0"
git push
```
