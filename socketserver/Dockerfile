#FROM node:8.9-alpine
FROM node:10-alpine
WORKDIR /home/node/app

RUN npm install -g nodemon
RUN npm install express
RUN npm install socket.io
RUN npm install superagent
RUN npm install mysql
ADD package.json /home/node/app
RUN npm install && npm list --depth=0 2>/dev/null
ADD src /home/node/app/src

EXPOSE 80
ENV PORT 80

CMD [ "nodemon" ]
#CMD ["node","./src/index.js"]