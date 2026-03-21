FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN mkdir -p /home/vscode/project
WORKDIR /home/vscode/project

# Install base utilities
RUN apt-get clean && rm -rf /var/lib/apt/lists/* \
    && apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y sqlite3 python3-pip tmux jq unzip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install zsh plugins
RUN git clone https://github.com/zsh-users/zsh-completions.git /home/vscode/.oh-my-zsh/custom/plugins/zsh-completions && \
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git /home/vscode/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting && \
    git clone https://github.com/zsh-users/zsh-autosuggestions.git /home/vscode/.oh-my-zsh/custom/plugins/zsh-autosuggestions

RUN cp /home/vscode/.zshrc /home/vscode/.zshrc.bak

RUN echo "$(cat /home/vscode/.zshrc)" | awk '{gsub(/plugins=\(git\)/, "plugins=(git zsh-completions zsh-syntax-highlighting zsh-autosuggestions)")}1' > /home/vscode/.zshrc.replaced && mv /home/vscode/.zshrc.replaced /home/vscode/.zshrc

# Define the location of the npm cache to avoid permission issues
RUN echo 'export npm_config_cache=/home/vscode/tmp/npm-cache' >> /home/vscode/.zshrc

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Playwright system dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libatspi2.0-0 \
        libwayland-client0 libxext6 libx11-xcb1 xvfb fonts-freefont-ttf \
        fonts-noto-color-emoji libvulkan1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install desktop components for headed browser automation via noVNC
# x11vnc: exposes the Xvfb display as a VNC server
# novnc: web-based VNC viewer (includes websockify for WebSocket proxying)
# fluxbox: lightweight window manager so browser windows render correctly
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y x11vnc novnc fluxbox \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Playwright Chromium browser for both vscode (local dev) and root (CI).
ARG PLAYWRIGHT_VERSION=1.52.0
USER vscode
RUN npx playwright@${PLAYWRIGHT_VERSION} install chromium
USER root
RUN npx playwright@${PLAYWRIGHT_VERSION} install chromium

# Pre-install MCP servers globally so npx doesn't cold-download them at Claude startup.
RUN npm install -g @playwright/mcp @prowi/deskcheck

# Pre-install the MCP-managed Chromium browser for vscode user.
USER vscode
RUN node "$(npm root -g)/@playwright/mcp/node_modules/.bin/playwright" install chromium
USER root

# Install Bun runtime for vscode user (required for claude-code-action)
USER vscode
RUN curl -fsSL https://bun.sh/install | bash
USER root
RUN echo 'export BUN_INSTALL="/home/vscode/.bun"' >> /home/vscode/.zshrc \
    && echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> /home/vscode/.zshrc

# Install Claude Code CLI, uv, and Python tools for vscode user
USER vscode
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Install tarnished CLI tool (file state checkpoint tracking)
RUN /home/vscode/.local/bin/uv tool install tarnished
# Install mcp-proxy (bridges Claude Code's stdio MCP to SSE servers)
RUN /home/vscode/.local/bin/uv tool install mcp-proxy
USER root

RUN echo 'export PATH="$PATH:/home/vscode/.claude/local/bin"' >> /home/vscode/.zshrc
RUN echo 'export PATH="$PATH:/home/vscode/.local/bin"' >> /home/vscode/.zshrc

# Install Bun and Claude Code for root user (GitHub Actions runs as root)
RUN curl -fsSL https://bun.sh/install | bash \
    && echo 'export BUN_INSTALL="$HOME/.bun"' >> /root/.bashrc \
    && echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> /root/.bashrc
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && echo 'export PATH="$HOME/.local/bin:$PATH"' >> /root/.bashrc
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && echo 'export PATH="$HOME/.local/bin:$PATH"' >> /root/.bashrc
RUN /root/.local/bin/uv tool install tarnished \
    && ln -s /root/.local/bin/tarnished /usr/local/bin/tarnished \
    && ln -s /root/.local/bin/uvx /usr/local/bin/uvx

# Create symlinks for devtools commands
RUN ln -s /home/vscode/project/devtools/services/desktop.sh /usr/local/bin/service:desktop

# Make devtools scripts executable
RUN find /home/vscode/project/devtools -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

RUN chown -R vscode:vscode /home/vscode/project
RUN chmod -R 700 /home/vscode/project

# Fix ownership of vscode home directory files
RUN chown -R vscode:vscode /home/vscode
