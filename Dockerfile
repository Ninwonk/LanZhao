FROM node:slim
WORKDIR /usr/src/app

RUN echo "deb http://mirrors.ustc.edu.cn/debian bookworm main contrib non-free\n\
deb http://mirrors.ustc.edu.cn/debian-security bookworm-security main\n\
deb http://mirrors.ustc.edu.cn/debian bookworm-updates main contrib non-free\n\
deb http://mirrors.ustc.edu.cn/debian bookworm-backports main contrib non-free" > /etc/apt/sources.list

# 安装构建依赖
RUN apt-get update && \
    apt-get install -y --fix-missing python3 make g++ && \
    ln -sf python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
ENV NODE_ENV=production