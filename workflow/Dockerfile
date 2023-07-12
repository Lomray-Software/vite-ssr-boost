FROM node:18.13.0-alpine

MAINTAINER Yarmaliuk Mikhail <mikhail.yarmaliuk@lomray.com>

ARG BUILD_PATH
ARG RUN_TYPE=ssr
ARG ENV_MODE=production
ARG WEB_PATH=/var/www

ENV NODE_ENV=${ENV_MODE}
ENV TYPE=${RUN_TYPE}

RUN mkdir -p $WEB_PATH

WORKDIR $WEB_PATH

COPY ${BUILD_PATH} $WEB_PATH/build
COPY ./package.json $WEB_PATH/package.json
COPY ./package-lock.json $WEB_PATH/package-lock.json

RUN npm ci --omit=dev

CMD npm run start:${TYPE} -- --host
