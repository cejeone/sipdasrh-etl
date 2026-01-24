# Use the official Node.js image
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files first (better for caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port from your .env (defaulting to 4000)
EXPOSE 4000

# Start the application
CMD ["npm", "start"]