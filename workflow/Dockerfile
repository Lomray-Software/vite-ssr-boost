FROM node:20.10.0-alpine

LABEL org.opencontainers.image.title="vite-ssr-boost"
LABEL org.opencontainers.image.description="Container to run pre-built 'vite-ssr-boost' applications"
LABEL org.opencontainers.image.authors="Yarmaliuk Mikhail <mikhail.yarmaliuk@lomray.com>"
LABEL org.opencontainers.image.url="https://github.com/Lomray-Software/vite-ssr-boost"
LABEL org.opencontainers.image.vendor="Lomray Software"
LABEL org.opencontainers.image.licenses=MIT

ARG BUILD_PATH
ARG RUN_TYPE=ssr
ARG ENV_MODE=production
ARG WEB_PATH=/var/www
ARG INSTALL_COMMAND="npm ci"

ENV NODE_ENV=${ENV_MODE}
ENV TYPE=${RUN_TYPE}

RUN mkdir -p $WEB_PATH

WORKDIR $WEB_PATH

COPY package.json ./
COPY package-lock.json* ./
COPY yarn.lock* ./
COPY pnpm-lock.yaml* ./

RUN ${INSTALL_COMMAND}

COPY ${BUILD_PATH} $WEB_PATH/build

CMD npm run start:${TYPE} -- --host
