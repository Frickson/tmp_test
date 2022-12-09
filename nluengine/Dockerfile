FROM cbengine
#source /etc/profile

#ENV JAVA_HOME /usr/lib/jre1.8.0_271
#RUN export PATH=$JAVA_HOME/bin:$PATH
#WORKDIR /usr/src
COPY config_spacy.yml /usr/src/projects/config_spacy.yml
COPY config_spacy_duck.yml /usr/src/projects/config_spacy_duck.yml
#COPY jre.tar.gz /usr/src/jre.tar.gz
#RUN tar -zxvf /usr/src/jre.tar.gz -C /usr/lib

#ENV DEBIAN_FRONTEND noninteractive
#RUN echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections
#RUN echo 'debconf debconf/frontend select Dialog' | debconf-set-selections	
#RUN mkdir /usr/share/man/man1/

#RUN pip3 install duckling

#RUN pip install --upgrade pip
#RUN pip3 install install-jdk
#CMD ['import jdk']
#CMD ['jdk.install("8")']

#RUN apt-get update \
#RUN sudo add-apt-repository universe \
#&& apt-get install -y -f --no-install-recommends libterm-readline-gnu-perl \
#&& apt-get install -y -f --no-install-recommends openjdk-8-jdk-headless \ 
#&& apt-get install -y -f --no-install-recommends openjdk-8-jdk \ 
#&& apt-get install -y -f --no-install-recommends openjdk-8-jdk \ 
#&& apt-get install -y -f --no-install-recommends openjdk-7-jdk \
#&& apt-get install -y -f --no-install-recommends default-jdk \
#&& pip3 install duckling

EXPOSE 5000

CMD ["python", "-m", "rasa_nlu.server", "--path", "projects", "-c", "/usr/src/projects/config_spacy.yml", "--debug", "-v"]
