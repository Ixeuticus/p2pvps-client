/*
 *  The primary functions of this program are to:
 *  -Establish a reverse SSH tunnel with the SSH server
 *  -Run a heartbeat API that updates a timestamp on the P2P VPS server every 2 minutes.
 */

"use strict";

const tunnel = require("reverse-tunnel-ssh"); //tunnel is a ssh2 clientConnection object
const request = require("request"); //Used for CURL style requests.
const express = require("express");
const winston = require("winston");

global.config = false;

try {
  global.config = require("./config.json");
  winston.info(`Connecting device to P2P VPS server with ID ${global.config.deviceId}`);
} catch (err) {
  console.error("Could not open the config.json file!", err);
  process.exit(1);
}

// Set up the Winston logging.
winston.add(winston.transports.File, {
  filename: "/usr/src/app/logs/connect-client.log",
  maxFiles: 1,
  colorize: false,
  timestamp: true,
  datePattern: ".yyyy-MM-ddTHH-mm",
  maxsize: 1000000,
  json: false,
});

// Set the logging level.
winston.level = "debug";

// Start first line of the log.
const now = new Date();
winston.log("info", `Application starting at ${now}`);

const app = express();
const port = 4010;

/*
 * Use Handlebars for templating
 */
const exphbs = require("express3-handlebars");
//let hbs;

// For gzip compression
//app.use(express.compress());

/*
 * Config for Production and Development
 */
app.engine(
  "handlebars",
  exphbs({
    // Default Layout and locate layouts and partials
    defaultLayout: "main",
    layoutsDir: "views/layouts/",
    partialsDir: "views/partials/",
  })
);

// Locate the views
app.set("views", `${__dirname}/views`);

// Locate the assets
app.use(express.static(`${__dirname}/assets`));

// Set Handlebars
app.set("view engine", "handlebars");

// Index Page
app.get("/", function(request, response, next) {
  response.render("index");
});

/* Start up the Express web server */
app.listen(process.env.PORT || port);
winston.info(`P2P VPS Keep Alive timer started on port ${port}`);

// Check in with the P2P VPS server every 2 minutes with this API.
// This lets the server know the Client is still connected.
const checkInTimer = setInterval(function() {
  //Register with the server by sending the benchmark data.
  request.get(
    {
      url: `http://${global.config.serverIp}:${global.config.serverPort}/api/deviceCheckIn/${
        global.config.deviceId
      }`,
      // form: obj
    },
    function(error, response, body) {
      try {
        debugger;
        //If the request was successfull, the server will respond with username, password, and port to be
        //used to build the Docker file.
        if (!error && response.statusCode === 200) {
          debugger;

          //Convert the data from a string into a JSON object.
          const data = JSON.parse(body); //Convert the returned JSON to a JSON string.

          if (data.success) {
            const now = new Date();
            winston.info(
              `Checked in for device ${global.config.deviceId} at ${now.toLocaleString()}`
            );
          } else {
            console.error(`Check-in failed for ${global.config.deviceId}`);
          }
        } else {
          debugger;

          // Server responded with some other status than 200.
          if (response) {
            if (response.statusCode !== 200)
              console.error("P2P VPS server rejected checking: ", response);
          } else if (error.code === "EHOSTUNREACH" || error.code === "ECONNREFUSED") {
            // Could not connect to the server.
            debugger;
            winston.info(`Warning: Could not connect to server at ${now.toLocaleString()}`);
            return;
          } else {
            console.error(
              "Server responded with error when trying to register the device: ",
              error
            );
            console.error(
              "Ensure the ID in your deviceGUID.json file matches the ID in the Owned Devices section of the marketplace."
            );
          }
        }
      } catch (err) {
        winston.info(`connect-client.js exiting with error: ${err}`);
      }
    }
  );
}, 120000);

// Establish a reverse SSH connection.
function createTunnel() {
  try {
    const conn = tunnel(
      {
        host: global.config.sshServer,
        port: global.config.sshServerPort, //The SSH port on the server.
        username: "sshuser",
        password: "sshuserpassword",
        dstHost: "0.0.0.0", // bind to all IPv4 interfaces
        dstPort: global.config.sshTunnelPort, //The new port that will be opened
        //srcHost: '127.0.0.1', // default
        srcPort: 3100, // The port on the Pi to tunnel to.
        //readyTimeout: 20000,
        //debug: myDebug,
      },
      function(error, clientConnection) {
        if (error) {
          winston.info("There was an error in connect-client.js/tunnel()!");
          console.error(JSON.stringify(error, null, 2));
        } else {
          winston.info(
            `Reverse tunnel established on destination port ${global.config.sshTunnelPort}`
          );
        }
      }
    );

    conn.on("error", function(error) {
      debugger;

      // Could not connect to the internet.
      if (error.level === "client-timeout" || error.level === "client-socket") {
        debugger;
        winston.info("Warning, could not connect to SSH server. Waiting before retry.");
      } else {
        console.error("Error with connect-client.js: ");
        console.error(JSON.stringify(error, null, 2));
      }

      // Try again in a short while.
      setTimeout(function() {
        createTunnel();
      }, 30000);
    });

    conn.on("close", function(val) {
      winston.info("SSH connection for connect-client.js was closed.");
    });

    conn.on("end", function(val) {
      winston.info("SSH connection for connect-client ended.");
    });
  } catch (err) {
    console.error("I caught the error!");
    console.error(JSON.stringify(err, null, 2));
  }
}

// Execute the first time.
setTimeout(function() {
  createTunnel();
}, 5000);

function myDebug(val) {
  winston.info(val);
}
