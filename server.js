#!/usr/bin/env node

const fs = require('fs');
const express = require('express');
const uuid = require('uuid').v4;
const session = require('express-session');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const sqlite3 = require('sqlite3');
const sqliteStoreFactory = require('express-session-sqlite').default;
const SqliteStore = sqliteStoreFactory(session);
const { showFlights, fbo } = require('./flights.js');
const { google } = require('googleapis');
const RFC4122 = require('rfc4122');

const port = 8080;
const admin = {id: '42', email: 'ymf', password: 'ymf_ymf'};
const myCalendarId = "1luv5uti2j7hnq1ddcofv0sbn4@group.calendar.google.com";
const awcAirports = ['KSFO', 'KOAK', 'KSQL', 'KPAO', 'KSJC', 'KLVK', 'KHWD'];

const getJSONFile = fname => {
    try {
        return JSON.parse(fs.readFileSync(__dirname + '/' + fname));
    } catch(e) {
        console.log(`failed to open JSON file: ${fname}`);
        return null;
    }
};
const googleClient = getJSONFile(".gapi");
const userTokenFile = ".utoken";
let userAccessToken = getJSONFile(userTokenFile);

const getAircraftLink = aircraft => {
    if (fbo == 'advantage') {
        return `https://www.advantage-aviation.com/aircraft/n${aircraft.toLowerCase()}`;
    } else {
        return '';
    }
}

passport.use(new LocalStrategy({ usernameField: 'user' },
    (email, password, done) => {
        if (email === admin.email && password === admin.password) {
            return done(null, admin)
        }
        return done(null, false);
    }
));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

let flights = null;
let squawks_ = null;
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
    genid: (req) => uuid(),
    secret: 'myfbo-flights',
    resave: false,
    saveUninitialized: true,
    store: new SqliteStore({
      driver: sqlite3.Database,
      path: './myfbo-flights-server.db',
      ttl: 30 * 86400 * 1000,
      prefix: 'sess:',
      cleanupInterval: 300000
    }),
}));
app.use(passport.initialize());
app.use(passport.session());

function getRoot(req) {
    let root = req.header('__webroot');
    if (root === undefined)
        root = '';
    return root;
}

function genSquawks(squawks) {
    let res = '';
    Object.keys(squawks).forEach((key) => {
            res += `<div><h4>${key}</h4>${squawks[key]}</div>`
    })
    return res;
}

const htmlHeader = `
<html>
    <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      strong.code::after {
        content: "Airport:";
        margin-right: 1ex;
      }
      strong.taf::after {
        content: "TAF:";
        margin-right: 1ex;
      }
      strong.metar::after {
        content: "METAR:";
        margin-right: 1ex;
      }
      div.taf {
        display: inline-block;
        vertical-align: top;
      }
      table.ap td {
        vertical-align: top;
      }
      table.ap td.label {
        font-size: 80%;
        text-align: right;
      }
      .indent {
        margin-right: 4ex;
      }
      form.cell {
        margin-top: 4ex;;
        margin-right: 2ex;
        display: inline-block;
      }
      input[type="submit"] {
        background-color: #3c3836;
        color: #fbf1c7;
        border: none;
        min-height: 5ex;
        padding-left: 1ex;
        padding-right: 1ex;
      }
      input[type="submit"]:hover {
        background-color: #504945;
        cursor: pointer;
      }
      input[type="text"] {
        background-color: #3c3836;
        color: #fff !important;
        -webkit-box-shadow: 0 0 0 30px #3c3836 inset !important;
        -webkit-text-fill-color: #fbf1c7 !important;
        border: 0.5px solid #fbf1c7;
        min-height: 3ex;
      }
      input[type="password"] {
        background-color: #3c3836;
        color: #fff !important;
        -webkit-box-shadow: 0 0 0 30px #3c3836 inset !important;
        -webkit-text-fill-color: #fbf1c7 !important;
        border: 0.5px solid #fbf1c7;
        min-height: 3ex;
      }
      input, button, table, h3, h4 {
        font-size: inherit;
      }
      table td.left {
        text-align: right;
      }
      body {
        background-color: #282828;
        color: #fbf1c7;
        font-size: 1.0rem;
      }
      @media print {
        body {
            zoom: 95%;
            color: #282828;
            background-color: #fbf1c7;
        }
        input {
            display: none;
        }
        .atc {
            display: none;
        }
        .flights {
            display: none;
        }
      }
      hr {
        border: 0;
        height: 1px;
        background: #665c54;
        background-image: linear-gradient(to right, #282828, #665c54, #282828);
      }
      table.decoded td {
        background-color: inherit !important;
      }
      table.decoded, table.ap {
        padding: 1ex;
        border: 0.5px solid #504945;
        margin-bottom: 1ex;
      }
      .dateText {
        display: block;
        margin-bottom: 1ex;
      }
      img {
        max-width: 100%;
      }
      .airmet {
        position: relative;
        width: 650px;
        max-width: 100%;
      }
      div.airmet .overlay {
        position: absolute;
        left: 0px;
        top: 0px;
        width: 100%;
      }
      div.pre {
        font-family: monospace;
      }
    </style>
    </head><body>`;
const htmlFooter = '</body></html>';
const awcInfo = `
    <hr>
    <div class="atc">
    <span>KPAO ATC:</span>
    <audio controls autoplay style="vertical-align: middle; margin-left: 5px;">
        <source src="https://s1-bos.liveatc.net/kpao2?noncache=" type="audio/ogg">
    </audio>
    <span>KPAO ATIS:</span>
    <audio controls autoplay style="vertical-align: middle; margin-left: 5px;">
        <source src="https://s1-fmt2.liveatc.net/kpao2_atis?noncache=" type="audio/ogg">
    </audio>
    </div>
    <hr>
    <div id="awc">
      <h3>Info from aviationweather.gov</h3>
      <h4>Raw</h4>
    </div>
    <script>
      var formatted = {};
      var awcAirports = [${awcAirports.map(s => `"${s}"`).join(',')}];
      fetch('https://bft.rocks/awc/metar/data?ids=' + awcAirports.map(s => s.toLowerCase()).join('+') + '&format=raw&date=&hours=0&taf=on',{
        method: 'GET',
        mode: 'cors',
      }).then(response => response.text())
        .then(html => {
          var parser = new DOMParser();
          var doc = parser.parseFromString(html, 'text/html');
          doc.getElementById('app_menu').remove();
          var raw = doc.getElementById('awc_main_content_wrap');

          raw.querySelectorAll('code').forEach(e => {
            var taf = e.innerText.match('(K[A-Z]*) [0-9]*Z');
            var metar = e.innerText.match('(K[A-Z]*) [0-9]*Z .*A[0-9]{4}');
            if (metar) {
              var ap = metar[1];
              e.innerHTML = e.innerHTML.replace(ap, '');
              if (!formatted[ap]) {
                formatted[ap] = {taf: null, metar: null};
              }
              formatted[ap].metar = e;
            } else if (taf) {
              e.innerHTML = e.innerHTML.replaceAll('&nbsp;&nbsp;', '<span class="indent"></span>');
              var wrapper = document.createElement('div');
              wrapper.classList = 'taf';
              e.parentNode.insertBefore(wrapper, e);
              wrapper.parentNode.removeChild(e);
              wrapper.appendChild(e);
              var ap = taf[1];
              e.innerHTML = e.innerHTML.replace(ap, '');
              if (!formatted[ap]) {
                formatted[ap] = {taf: null, metar: null};
              }
              formatted[ap].taf = wrapper;
            }
          });
          var info = document.createElement('div');

          var date = raw.querySelector('p[clear="both"]');
          var dateText = document.createElement('code');
          dateText.classList = 'dateText';
          dateText.innerHTML = date.innerText.replace(/.*Data at: ([0-9]*) UTC ([0-9]*) ([a-zA-Z]*) ([0-9]*).*/, 'Time @ $1Z [$3 $2, $4]');
          info.appendChild(dateText);
          awcAirports.forEach(ap => {
            var table = document.createElement('table');
            table.classList = 'ap';

            var code = table.insertRow();
            var codeLabel = document.createElement('strong');
            codeLabel.classList = 'code';
            var apCode = document.createElement('code');
            apCode.innerText = ap;
            code.insertCell().appendChild(codeLabel);
            code.insertCell().appendChild(apCode);
            codeLabel.parentNode.classList = 'label';

            var metar = table.insertRow();
            var metarLabel = document.createElement('strong');
            var metarCell = formatted[ap] !== undefined ? formatted[ap].metar : null;
            if (metarCell === null) {
                metarCell = document.createElement('code');
                metarCell.innerText = "N/A";
            }
            metarLabel.classList = 'metar';
            metar.insertCell().appendChild(metarLabel);
            metar.insertCell().appendChild(metarCell);
            metarLabel.parentNode.classList = 'label';

            var taf = table.insertRow();
            var tafLabel = document.createElement('strong');
            var noTAF = document.createElement('code');
            noTAF.innerText = 'N/A';
            var tafCell = formatted[ap] !== undefined ? (formatted[ap].taf || noTAF) : noTAF;
            tafLabel.classList = 'taf';
            taf.insertCell().appendChild(tafLabel);
            taf.insertCell().appendChild(tafCell);
            tafLabel.parentNode.classList = 'label';

            info.appendChild(table);
          });
          document.getElementById('awc').appendChild(info);
        }).then(() => {
            for (var t = 0; t < 15; t += 3) {
              var airmet = document.createElement('div');
              airmet.id = 'airmet' + t;
              airmet.classList = 'airmet';
              var img = document.createElement('img');
              img.src = 'https://www.aviationweather.gov/images/gairmet/blanks/blank_us_map.gif';
              airmet.appendChild(img);
              var urlBase = 'https://www.aviationweather.gov/data/products/gairmet/';
              var layers = [
                'gairmet_ifr_us',
                'gairmet_mt-obsc_us',
                'gairmet_turb-lo_us',
                'gairmet_sfc-wind_us',
                'gairmet_llws_us',
              ];
              for (var i = 0; i < layers.length; i++) {
                img = document.createElement('img');
                img.classList = 'overlay';
                img.src = urlBase + 'F' + ("0" + t).slice(-2) + '_' + layers[i] + '.gif';
                airmet.appendChild(img);
              }

              var h4 = document.createElement('h4');
              h4.innerText = 'AIRMET: ' + (t == 0 ? 'Latest' : '+' + t + ' hours');
              awc.appendChild(h4);
              awc.appendChild(airmet);
            }

            
            function htmlToElement(html) {
                var t = document.createElement('template');
                html = html.trim();
                t.innerHTML = html;
                return t.content.firstChild;
            }
            var btn1HTML = '<form action="https://www.aviationweather.gov/gairmet" class="cell"><input type="submit" value="AIRMET" onclick=""/></form>';
            var btn2HTML = '<form action="https://www.aviationweather.gov/sigmet" class="cell"><input type="submit" value="SIGMET" onclick=""/></form>';
            awc.appendChild(htmlToElement(btn1HTML));
            awc.appendChild(htmlToElement(btn2HTML));

            fetch('https://bft.rocks/awc/data/products/progs/', {
              method: 'GET',
              mode: 'cors',
            }).then(response => response.text())
            .then(html => {
              var parser = new DOMParser();
              var doc = parser.parseFromString(html, 'text/html');
              var progs = Array.from(doc.querySelectorAll('tr a'))
                                .filter(a => a.href.match(/F[0-9][0-9][0-9]_wpc_.*\\.gif/))
                                .map(a => {
                var m = a.href.match(/.*\\/F([0-9][0-9][0-9])(.*)/);
                return [m[1], m[2]];
              });
              progs.forEach(m => {
                var img = document.createElement('img');
                img.src = 'https://www.aviationweather.gov/data/products/progs/F' + m[0] + m[1];
                img.classList = 'airmet';
                var h4 = document.createElement('h4');
                var hrs = parseInt(m[0]);
                h4.innerText =  'Prog: ' + (hrs == 0 ? 'Latest' : ('+' + (
                                hrs > 60 ? (hrs / 24).toFixed(0) + ' days': hrs + ' hours')));
                awc.appendChild(h4);
                awc.appendChild(img);
              });
            }).then(() => {
              if (location.hash) {
                  var hash = location.hash;
                  location.hash = '';
                  location.hash = hash;
              }
            });
        });
    </script>`;

app.get('/', async (req, res) => {
    if (flights === null) {
        const { text, squawks } = await showFlights();
        flights = text;
        squawks_ = genSquawks(squawks);
    }
    let root = getRoot(req);
    res.set('Content-Type', 'text/html');
    res.write(htmlHeader);
    res.write(`<pre class="flights">${flights}</pre> \
        <h3>Squawks</h3>
        <div class="pre">${squawks_}</div>
        ${req.user ?
        `<form action="${root}/update" method="POST" style="display: inline-block;"> \
            <input type="submit" value="Update" onclick="this.disabled=true; this.value='Updating'; this.form.submit();" style="min-width: 20ex;" /> \
        </form> \
        <form action="${root}/logout" method="POST" style="display: inline-block;"> \
            <input type="submit" value="Logout"/> \
        </form>` :
        `<form action="${root}/login" method="GET"><input type="submit" value="Login"/></form>`}`);
	res.write(awcInfo);
    res.end(htmlFooter);
});

app.get('/login', (req, res) => {
    res.set('Content-Type', 'text/html');
    res.write(htmlHeader);
    res.write('<form action="login" method="POST"><table> \
        <tr><td class="left">Username:</td><td><input name="user" type="text"/></td></tr> \
        <tr><td class="left">Password:</td><td><input name="password" type="password"/></td></tr> \
        <tr><td colspan="2" style="text-align: right"><input type="submit" value="Login" style="min-height: 5ex;"/></td></tr></table></form>');
    res.end(htmlFooter);
});

app.post('/login', (req, res, next) => {
    let root = getRoot(req);
    passport.authenticate('local', (err, user, info) => {
        if (err) { return next(err); }
        if (!user) { return res.redirect(`${root}/login`); }
        req.login(user, (err) => {
            res.redirect(`${root}/`);
        });
    })(req, res, next);
});

app.post('/logout', (req, res) => {
    let root = getRoot(req);
    req.logout();
    res.redirect(`${root}/`);
});


app.post('/update', async (req, res) => {
    let root = getRoot(req);
    if (req.user) {
        console.log('update');
        const { text, records } = await showFlights();
        flights = text;
        squawks_ = genSquawks(squawks);
        res.redirect(`${root}/`);
        if (userAccessToken) {
            let rfc4122 = new RFC4122();
            const auth = new google.auth.OAuth2();
            auth.setCredentials({'access_token': userAccessToken});
            const cal = google.calendar({version: 'v3', auth});
            for (const r of records) {
                const eventId = rfc4122.v5(`myfbo-flight-${r.entity}-${r.start.format()}-${r.end.format()}`, 'string').replace(/-/g, '');
                const event = {
                    id: eventId,
                    summary: `Flight Training (N${r.entity})`,
                    description: getAircraftLink(r.entity),
                    end: {
                        'dateTime': r.end.format(),
                    },
                    start: {
                        'dateTime': r.start.format(),
                    }
                };
                try {
                    await cal.events.insert({
                        calendarId: myCalendarId,
                        resource: event,
                    });
                    console.log("inserted calendar event");
                } catch (err) {
                    if (err.errors[0].reason == 'duplicate') {
                        try {
                            await cal.events.update({
                                calendarId: myCalendarId,
                                eventId,
                                resource: event,
                            });
                            console.log("updated calendar event");
                        } catch(err) {
                            console.log(err);
                        }
                    } else {
                        console.log(err);
                    }
                }
            };
        }
    } else {
        res.redirect(`${root}/login`);
    }
    res.end();
});

if (googleClient) {
    const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
    passport.use(new GoogleStrategy({
        clientID: googleClient.clientID,
        clientSecret: googleClient.clientSecret,
        callbackURL: googleClient.callbackURL,
        scope: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events']
    }, (accessToken, refreshToken, profile, done) => {
        profile.accessToken = accessToken;
        return done(null, profile);
    }));

    app.get('/auth',
        passport.authenticate('google', { session: false }));

    app.get('/auth/callback',
        passport.authenticate('google', { session: false, failureRedirect: '/' }),
        function(req, res) {
            userAccessToken = req.user.accessToken;
            try {
                fs.writeFileSync(userTokenFile, JSON.stringify(userAccessToken));
            } catch(e) {
                console.log(`failed to write to JSON file: ${userTokenFile}`);
            }
            res.redirect('../');
        });
}

app.listen(port, () => {
    console.log(`listening at localhost:${port}`);
})
