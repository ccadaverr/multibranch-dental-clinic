FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
# Toolchain only: no source, credentials, clinic database, providers or existing cluster in the image.
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod 755 /usr/sbin/policy-rc.d \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg postgresql-common \
    php8.3-cli php8.3-pgsql php8.3-xml php8.3-mbstring php8.3-curl php8.3-bcmath php8.3-zip python3 git tar socat \
    && mkdir -p /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && printf 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main\n' > /etc/apt/sources.list.d/pgdg.list \
    && printf 'create_main_cluster = false\n' >> /etc/postgresql-common/createcluster.conf \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-18 \
    && useradd --create-home --uid 1001 joevan \
    && mkdir -p /workspace /private && chown joevan:joevan /workspace /private && chmod 700 /private
USER joevan
WORKDIR /workspace
CMD ["sleep", "infinity"]
