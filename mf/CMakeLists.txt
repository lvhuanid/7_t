cmake_minimum_required(VERSION 3.22)
project(netconf-yang-ecosystem C)

# ============================================================================
# Workspace CMakeLists.txt — builds all mf/ projects in dependency order
#
# Dependency chain:
#   libyang (base)
#   ├── sysrepo     ─┬── netopeer2
#   ├── libnetconf2 ─┘
#   ├── libmf       ─── (depends on libyang + sysrepo)
#   └── libcli      ─── (independent)
#
# Usage:
#   cd mf && mkdir build && cd build
#   cmake .. -DCMAKE_INSTALL_PREFIX=$(pwd)/install
#   make -j$(nproc)
# ============================================================================

include(ExternalProject)

# ---------------------------------------------------------------------------
# Common options passed to all sub-projects
# ---------------------------------------------------------------------------
set(COMMON_CMAKE_ARGS
    -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
    -DCMAKE_INSTALL_PREFIX=${CMAKE_INSTALL_PREFIX}
    -DCMAKE_PREFIX_PATH=${CMAKE_INSTALL_PREFIX}
    -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
    -DBUILD_SHARED_LIBS=ON
    -DENABLE_TESTS=OFF
    -DENABLE_VALGRIND_TESTS=OFF
    -DENABLE_COVERAGE=OFF
)

# Let subsequent projects find installed libraries via pkg-config
set(ENV{PKG_CONFIG_PATH} "${CMAKE_INSTALL_PREFIX}/lib/pkgconfig:$ENV{PKG_CONFIG_PATH}")

# Avoid systemd/sysrepo module setup during install
set(SYSREPO_NO_SETUP ON)

# ============================================================================
# 1. libyang — YANG data modeling language parser & toolkit
# ============================================================================
ExternalProject_Add(libyang
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libyang
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/libyang
    INSTALL_DIR ${CMAKE_INSTALL_PREFIX}
    CMAKE_ARGS
        ${COMMON_CMAKE_ARGS}
        -DENABLE_COMMON_TARGETS=OFF
    LIST_SEPARATOR |
)

# ============================================================================
# 2a. sysrepo — YANG-based datastore (depends on libyang)
# ============================================================================
ExternalProject_Add(sysrepo
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/sysrepo
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/sysrepo
    INSTALL_DIR ${CMAKE_INSTALL_PREFIX}
    DEPENDS libyang
    CMAKE_ARGS
        ${COMMON_CMAKE_ARGS}
        -DENABLE_COMMON_TARGETS=OFF
        -DCMAKE_C_FLAGS=-I${CMAKE_INSTALL_PREFIX}/include
    LIST_SEPARATOR |
)

# ============================================================================
# 2b. libnetconf2 — NETCONF protocol library (depends on libyang)
# ============================================================================
ExternalProject_Add(libnetconf2
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libnetconf2
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/libnetconf2
    INSTALL_DIR ${CMAKE_INSTALL_PREFIX}
    DEPENDS libyang
    CMAKE_ARGS
        ${COMMON_CMAKE_ARGS}
        -DENABLE_COMMON_TARGETS=OFF
        -DENABLE_SSH_TLS=ON
        -DENABLE_EXAMPLES=OFF
        -DCMAKE_C_FLAGS=-I${CMAKE_INSTALL_PREFIX}/include
    LIST_SEPARATOR |
)

# ============================================================================
# 3a. netopeer2 — NETCONF server & CLI (depends on libyang + libnetconf2 + sysrepo)
# ============================================================================
ExternalProject_Add(netopeer2
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/netopeer2
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/netopeer2
    INSTALL_DIR ${CMAKE_INSTALL_PREFIX}
    DEPENDS libyang;sysrepo;libnetconf2
    CMAKE_ARGS
        ${COMMON_CMAKE_ARGS}
        -DSYSREPO_SETUP=OFF
        -DBUILD_NETOPEER2_LIB=OFF
        -DBUILD_CLI=ON
        -DBUILD_SERVER=ON
        -DCMAKE_C_FLAGS=-I${CMAKE_INSTALL_PREFIX}/include
    LIST_SEPARATOR |
)

# ============================================================================
# 3b. libmf — micro-framework library (depends on libyang + sysrepo)
# ============================================================================
ExternalProject_Add(libmf
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libmf
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/libmf
    INSTALL_DIR ${CMAKE_INSTALL_PREFIX}
    DEPENDS libyang;sysrepo
    CMAKE_ARGS
        ${COMMON_CMAKE_ARGS}
        -DCMAKE_C_FLAGS=-I${CMAKE_INSTALL_PREFIX}/include
    LIST_SEPARATOR |
)

# ============================================================================
# 4. libcli — Cisco-like CLI library (independent)
# ============================================================================
ExternalProject_Add(libcli
    SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libcli
    BINARY_DIR ${CMAKE_CURRENT_BINARY_DIR}/libcli
    INSTALL_DIR ${CMAKE_INSTALL_PREFIX}
    CONFIGURE_COMMAND ""
    BUILD_COMMAND make -C ${CMAKE_CURRENT_SOURCE_DIR}/libcli
        CC=${CMAKE_C_COMPILER}
        PREFIX=${CMAKE_INSTALL_PREFIX}
        TESTS=0
        libcli.so libcli.a clitest
    INSTALL_COMMAND make -C ${CMAKE_CURRENT_SOURCE_DIR}/libcli
        PREFIX=${CMAKE_INSTALL_PREFIX}
        DESTDIR=
        install
    BUILD_IN_SOURCE TRUE
)
