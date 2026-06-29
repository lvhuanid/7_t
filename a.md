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
