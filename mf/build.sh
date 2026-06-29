#!/usr/bin/env bash
# ===========================================================================
# build.sh — Incremental build script for the NETCONF/YANG ecosystem
#
# Builds all projects in correct dependency order, installing to a common
# prefix so each subsequent project can find its dependencies.
#
# Usage:
#   ./build.sh              # Full build (Release)
#   ./build.sh debug        # Debug build
#   ./build.sh clean        # Clean build directories
#   ./build.sh <project>    # Build a specific project (libyang|sysrepo|libnetconf2|netopeer2|libmf|libcli)
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
INSTALL_DIR="${BUILD_DIR}/install"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

BUILD_TYPE="${1:-Release}"
case "${BUILD_TYPE}" in
    debug|Debug) BUILD_TYPE=Debug ;;
    release|Release) BUILD_TYPE=Release ;;
esac

export PKG_CONFIG_PATH="${INSTALL_DIR}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
export LD_LIBRARY_PATH="${INSTALL_DIR}/lib:${LD_LIBRARY_PATH:-}"

log()  { echo -e "${GREEN}[BUILD]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }
step() { echo -e "${CYAN}==>${NC} $*"; }

# ---------------------------------------------------------------------------
# Build a CMake-based project
# ---------------------------------------------------------------------------
build_cmake_project() {
    local name="$1"
    local src_dir="$2"
    local extra_args="${3:-}"

    step "Building ${name} (${BUILD_TYPE})..."
    mkdir -p "${BUILD_DIR}/${name}"
    cmake -S "${src_dir}" -B "${BUILD_DIR}/${name}" \
        -G "Unix Makefiles" \
        -DCMAKE_BUILD_TYPE="${BUILD_TYPE}" \
        -DCMAKE_INSTALL_PREFIX="${INSTALL_DIR}" \
        -DCMAKE_PREFIX_PATH="${INSTALL_DIR}" \
        -DBUILD_SHARED_LIBS=ON \
        -DENABLE_TESTS=OFF \
        -DENABLE_VALGRIND_TESTS=OFF \
        -DENABLE_COVERAGE=OFF \
        -DENABLE_COMMON_TARGETS=OFF \
        ${extra_args}
    cmake --build "${BUILD_DIR}/${name}" --parallel "${NPROC}"
    cmake --install "${BUILD_DIR}/${name}"
    log "${name} built and installed OK"
}

# ---------------------------------------------------------------------------
# Build libyang (base library, no mf-internal deps)
# ---------------------------------------------------------------------------
build_libyang() {
    build_cmake_project "libyang" "${SCRIPT_DIR}/libyang"
}

# ---------------------------------------------------------------------------
# Build sysrepo (depends on libyang)
# ---------------------------------------------------------------------------
build_sysrepo() {
    build_cmake_project "sysrepo" "${SCRIPT_DIR}/sysrepo"
}

# ---------------------------------------------------------------------------
# Build libnetconf2 (depends on libyang)
# ---------------------------------------------------------------------------
build_libnetconf2() {
    build_cmake_project "libnetconf2" "${SCRIPT_DIR}/libnetconf2" \
        "-DENABLE_SSH_TLS=ON -DENABLE_EXAMPLES=OFF"
}

# ---------------------------------------------------------------------------
# Build netopeer2 (depends on libyang + sysrepo + libnetconf2)
# ---------------------------------------------------------------------------
build_netopeer2() {
    build_cmake_project "netopeer2" "${SCRIPT_DIR}/netopeer2" \
        "-DSYSREPO_SETUP=OFF -DBUILD_NETOPEER2_LIB=OFF -DBUILD_CLI=ON -DBUILD_SERVER=ON"
}

# ---------------------------------------------------------------------------
# Build libmf (depends on libyang + sysrepo)
# ---------------------------------------------------------------------------
build_libmf() {
    build_cmake_project "libmf" "${SCRIPT_DIR}/libmf"
}

# ---------------------------------------------------------------------------
# Build libcli (independent, uses Makefile)
# ---------------------------------------------------------------------------
build_libcli() {
    step "Building libcli (${BUILD_TYPE})..."
    make -C "${SCRIPT_DIR}/libcli" \
        CC=gcc \
        PREFIX="${INSTALL_DIR}" \
        TESTS=0 \
        libcli.so libcli.a clitest
    make -C "${SCRIPT_DIR}/libcli" \
        PREFIX="${INSTALL_DIR}" \
        DESTDIR= \
        install
    log "libcli built and installed OK"
}

# ---------------------------------------------------------------------------
# Full build
# ---------------------------------------------------------------------------
build_all() {
    step "Starting full build (${BUILD_TYPE})..."
    mkdir -p "${BUILD_DIR}" "${INSTALL_DIR}"

    build_libyang
    build_sysrepo
    build_libnetconf2
    build_netopeer2
    build_libmf
    build_libcli

    echo ""
    log "All projects built successfully!"
    log "Install prefix: ${INSTALL_DIR}"
    echo ""
    echo "  export PKG_CONFIG_PATH=${INSTALL_DIR}/lib/pkgconfig:\${PKG_CONFIG_PATH}"
    echo "  export LD_LIBRARY_PATH=${INSTALL_DIR}/lib:\${LD_LIBRARY_PATH}"
    echo "  export PATH=${INSTALL_DIR}/bin:\${PATH}"
}

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
do_clean() {
    step "Cleaning build directories..."
    rm -rf "${BUILD_DIR}"
    log "Build directories removed"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${1:-all}" in
    clean)
        do_clean
        ;;
    libyang)
        build_libyang
        ;;
    sysrepo)
        build_sysrepo
        ;;
    libnetconf2)
        build_libnetconf2
        ;;
    netopeer2)
        build_netopeer2
        ;;
    libmf)
        build_libmf
        ;;
    libcli)
        build_libcli
        ;;
    debug|release|Release|all)
        build_all
        ;;
    *)
        echo "Usage: $0 {all|debug|clean|libyang|sysrepo|libnetconf2|netopeer2|libmf|libcli}"
        exit 1
        ;;
esac
