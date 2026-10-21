FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Base URL prepended to request paths. App.jsx paths already start with /api
# (e.g. /api/jobs), so leave this EMPTY: the browser then calls same-origin
# /api/... and nginx proxies to the backend. Setting it to /api yields /api/api/...
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Files in /etc/nginx/templates/*.template are run through envsubst at startup.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV BACKEND_UPSTREAM=backend:3000

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]