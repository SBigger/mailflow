# Stage 1: Build
FROM node:20-alpine AS build

RUN apk update && apk add --no-cache --upgrade curl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit
COPY . .

RUN ls -la

RUN npm run build

# Stage 2: Serve via Nginx
FROM nginx:stable-alpine

# Copy the compiled static assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy our configuration template into Nginx's template folder
COPY ./docker_files/app_image/config.template.json /etc/nginx/templates/config.json.template

# 💡 FIX: Tell Nginx to output the processed templates into the web root
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]