FROM node:20.10.0-alpine

MAINTAINER Yarmaliuk Mikhail <mikhail.yarmaliuk@lomray.com>

ARG BUILD_PATH
ARG RUN_TYPE=ssr
ARG ENV_MODE=production
ARG WEB_PATH=/var/www
ARG INSTALL_COMMAND="npm ci"

ENV NODE_ENV=${ENV_MODE}
ENV TYPE=${RUN_TYPE}

RUN mkdir -p $WEB_PATH

WORKDIR $WEB_PATH

COPY ${BUILD_PATH} $WEB_PATH/build
COPY ./package.json $WEB_PATH/package.json
COPY package-lock.json* yarn.lock* pnpm-lock.yaml* $WEB_PATH

RUN ${INSTALL_COMMAND}

CMD npm run start:${TYPE} -- --host
