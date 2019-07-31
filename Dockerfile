FROM node:alpine

RUN apk add -u g++ gcc git make python

WORKDIR /rock-paper-scissors

ADD package.json .

RUN npm i

ADD . .
