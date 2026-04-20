# This file is moved to the root directory before building the image

# base bun image (Alpine / musl)
FROM oven/bun:1.3.13-alpine as base

# set for base and all layer that inherit from it
ENV NODE_ENV production

# Install openssl/sqlite/fuse3/ca-certs
RUN apk add --no-cache fuse3 openssl sqlite ca-certificates

# Install all node_modules, including dev dependencies
FROM base as deps

WORKDIR /myapp

ADD package.json bun.lock bunfig.toml .npmrc ./
# NODE_ENV=development override: base sets NODE_ENV=production, which would
# make bun install skip devDependencies needed by the build stage.
RUN NODE_ENV=development bun install --frozen-lockfile

# Setup production node_modules
FROM base as production-deps

WORKDIR /myapp

ADD package.json bun.lock bunfig.toml .npmrc ./
RUN bun install --frozen-lockfile --production

# Build the app
FROM base as build

ARG COMMIT_SHA
ENV COMMIT_SHA=$COMMIT_SHA
# Placeholder so prisma.config.ts can resolve env('DATABASE_URL') at
# build time. Real URL is set in the final stage and at runtime by LiteFS.
ENV DATABASE_URL="file:/tmp/build-placeholder.db"

WORKDIR /myapp

COPY --from=deps /myapp/node_modules /myapp/node_modules

ADD . .

RUN bun run build

# Finally, build the production image with minimal footprint
FROM base

ENV FLY="true"
ENV LITEFS_DIR="/litefs/data"
ENV DATABASE_FILENAME="sqlite.db"
ENV DATABASE_PATH="$LITEFS_DIR/$DATABASE_FILENAME"
ENV DATABASE_URL="file:$DATABASE_PATH"
ENV CACHE_DATABASE_FILENAME="cache.db"
ENV CACHE_DATABASE_PATH="$LITEFS_DIR/$CACHE_DATABASE_FILENAME"
ENV INTERNAL_PORT="8080"
ENV PORT="8081"
ENV NODE_ENV="production"

# add shortcut for connecting to database CLI
RUN echo "#!/bin/sh\nset -x\nsqlite3 \$DATABASE_PATH" > /usr/local/bin/database-cli && chmod +x /usr/local/bin/database-cli
# and one for the cache database
RUN echo "#!/bin/sh\nset -x\nsqlite3 \$CACHE_DATABASE_URL" > /usr/local/bin/cache-database-cli && chmod +x /usr/local/bin/cache-database-cli

WORKDIR /myapp

# Generate random value and save it to .env file which will be loaded by dotenv
RUN INTERNAL_COMMAND_TOKEN=$(openssl rand -hex 32) && \
  echo "INTERNAL_COMMAND_TOKEN=$INTERNAL_COMMAND_TOKEN" > .env

COPY --from=production-deps /myapp/node_modules /myapp/node_modules

COPY --from=build /myapp/build /myapp/build
COPY --from=build /myapp/package.json /myapp/package.json
COPY --from=build /myapp/prisma /myapp/prisma
COPY --from=build /myapp/app/components/ui/icons /myapp/app/components/ui/icons
COPY --from=build /myapp/app/generated /myapp/app/generated

# prepare for litefs
COPY --from=flyio/litefs:0.5.11 /usr/local/bin/litefs /usr/local/bin/litefs
ADD other/litefs.yml /etc/litefs.yml
RUN mkdir -p /data ${LITEFS_DIR}

ADD . .

CMD ["litefs", "mount"]
