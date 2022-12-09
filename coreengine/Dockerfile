FROM cbengine

#ENV JAVA_HOME /usr/lib/jre1.8.0_271
#RUN export PATH=$JAVA_HOME/bin:$PATH
#COPY config_spacy.yml /usr/src/config_spacy.yml
#COPY config_spacy_duck.yml /usr/src/config_spacy_duck.yml
#COPY jre.tar.gz /usr/src/jre.tar.gz
#RUN tar -zxvf /usr/src/jre.tar.gz -C /usr/lib

#ENV DEBIAN_FRONTEND noninteractive
#RUN echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections
#RUN echo 'debconf debconf/frontend select Dialog' | debconf-set-selections	
#RUN mkdir /usr/share/man/man1/

#RUN pip3 install duckling
#RUN pip3 install --upgrade numpy

WORKDIR /usr/src
COPY src /usr/src/

#RUN pip install 'Keras==2.2.4' --force-reinstall \
#pip install 'h5py~=2.0' --force-reinstall
#&& pip install 'Keras-Applications==1.0.6' --force-reinstall \
#&& pip install 'Keras-Preprocessing==1.0.5' --force-reinstall
#Keras==2.2.4
#Keras-Applications==1.0.6
#Keras-Preprocessing==1.0.5

EXPOSE 80

CMD [ "python", "./app.py"]