FROM ubuntu:24.04

# Prevent interactive prompts during package install
ENV DEBIAN_FRONTEND=noninteractive

# Install build tools and all dependencies for the NETCONF/YANG ecosystem
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    gcc \
    g++ \
    gdb \
    make \
    git \
    ca-certificates \
    sudo \
    # Code formatting & quality
    clang-format \
    valgrind \
    # libyang dependencies
    libpcre2-dev \
    libxxhash-dev \
    # libnetconf2 dependencies (SSH/TLS)
    libssh-dev \
    libmbedtls-dev \
    libssl-dev \
    libcurl4-openssl-dev \
    libpam0g-dev \
    # sysrepo & netopeer2 dependencies
    libsystemd-dev \
    # Testing
    libcmocka-dev \
    # Utilities
    vim \
    less \
    tree \
    # Clean up
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set up a non-root user for development
ARG USERNAME=developer
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Fix for Ubuntu 24.04+:
# If UID 1000 is already taken by the default 'ubuntu' user, rename it to '$USERNAME'.
# Otherwise, create the group and user normally.
RUN if getent passwd $USER_UID | grep -q "^ubuntu:"; then \
    groupmod -n $USERNAME ubuntu && \
    usermod -l $USERNAME -d /home/$USERNAME -m ubuntu; \
    else \
    groupadd --gid $USER_GID $USERNAME && \
    useradd --uid $USER_UID --gid $USER_GID -m $USERNAME; \
    fi \
    && echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

USER $USERNAME
WORKDIR /workspaces/7_t

ENV DEBIAN_FRONTEND=dialog
