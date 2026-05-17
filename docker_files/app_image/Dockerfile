# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app

# No ARGs here! The build becomes environment-agnostic.
COPY package.json package-lock.json* ./
RUN npm install --no-audit
COPY . .
RUN npm run build

# Stage 2: Serve via Nginx
FROM nginx:stable-alpine

# Copy the compiled static assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy our configuration template into Nginx's special template folder
COPY ./docker_files/app_image/config.template.js /etc/nginx/templates/config.js.template

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]