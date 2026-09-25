Node and Mongo using Typescript basic setup just install and ready to serve

## Purpose

Our main purpose with this Skeleton is to start server application with node js and typescript and mongodb.

## Common Features

## Common Features

- Quick start
    - Simple scaffolding based on Typescript syntax
    - Easy global environment configuration and error handling
    - Flexible for adding new features


- Documentation Standards
    - Swagger documentation support and Postman collections
    - Clear instructions in the readme file


- Production Ready Setup 
    - Followed best practices for security and efficiency
    - Integrated Winston Logger and included only necessary npm modules
  
## Core NPM Module

- [x] `express`, `@types/express`
- [x] `@types/node`
- [x] `typescript`
- [x] `dotenv`
- [x] `cors`
- [x] `helmet`
- [x] `http-status`
- [x] `winston`

## Start The application in Development Mode

- Clone the Application `git clone https://github.com/dipu03/node-typescript-mongodb-boilerplate-setup-final.git`
- Install the dependencies `npm install`
- Start the application `npm run dev`

## Start The application in Production Mode

- Install the dependencies `npm install`
- Create the build `npm run build`
- Start the application `npm run start`
- Before starting make sure to update your `.env` values for your refrence just check `.env.example`

## Encryption

Set the `APPLY_ENCRYPTION` environment variable to `true` to enable encryption.

## Swagger API Documentation

The swagger documentation is available at the following url `${host}/docs`:  

## Default System Health Status API

- `${host}/api/system/info` - Return the system information in response
- `${host}/system/time` - Return the current time in response
- `${host}/system/usage` - Return the process and system memory usage in response
- `${host}/system/process` -  Return the process details in response