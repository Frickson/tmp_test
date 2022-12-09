FROM python:3.6-slim

WORKDIR /usr/src

#RUN apt-get clean
#RUN apt-get -y upgrade

RUN apt-get update \
&& apt-get install -y --no-install-recommends build-essential gcc libffi-dev python3-dev \
&& rm -rf /var/lib/apt/lists/* \
&& pip3 install --upgrade pip \
#RUN pip3 -v --no-cache-dir install 'regex==2018.01.10' \
&& pip3 --timeout=120 -v --no-cache-dir install 'rasa_nlu==0.12.3' \
&& pip3 --timeout=120 -v --no-cache-dir install 'rasa_core==0.10.2' \
&& pip3 --timeout=120 -v --no-cache-dir install sklearn_crfsuite sklearn Flask beautifulsoup4 \
&& pip3 --timeout=120 -v --no-cache-dir install 'spacy==2.0.12' \
&& python -m spacy download en
#&& apt-get purge -y --auto-remove build-essential gcc libffi-dev python3-dev

CMD ["python3"]

# --no-cache-dir graphviz libgraphviz-dev pkg-config libhdf5-dev
# pygraphviz h5py 