FROM nginx:1.12.1

RUN rm /etc/nginx/conf.d/*

ADD FX/cert.crt      /etc/ssl/certs/
ADD FX/cert.key      /etc/ssl/private/
ADD FX/proxy.conf    /etc/nginx/conf.d/
ADD homepage                        						 /home/homepage/
ADD chatbox                        							 /home/chatbox/

#ADD certs/dhparam.pem               /etc/ssl/certs/