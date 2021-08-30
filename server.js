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
const googleClient = JSON.parse(fs.readFileSync(__dirname + "/.gapi"));
const awcAirports = ['KPAO', 'KSFO', 'KSQL', 'KOAK'];

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
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
    genid: (req) => {
        console.log(req.sessionID);
        return uuid()
    },
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

const htmlHeader = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>';
const htmlFooter = '</body></html>';
const awcInfo = `
    <hr>
    <div id="awc"><h3>Info from aviationweather.gov</h3></div>
    <script>
      fetch('https://bft.rocks/awc/metar/data?ids=${awcAirports.map(s => s.toLowerCase()).join('+')}&format=raw&date=&hours=0&taf=on',{
              method: 'GET',
              mode: 'cors',
            }).then(response => response.text())
              .then(html => {
                      var parser = new DOMParser();
                      var doc = parser.parseFromString(html, 'text/html');
                      doc.getElementById('app_menu').remove();
                      var info = doc.getElementById('awc_main_content_wrap');
                      info.querySelectorAll('hr').forEach(e => e.removeAttribute('width'));
                      info.querySelectorAll('strong').forEach(e => {
                              var t = document.createElement('code');
                              t.innerText = e.innerText;
                              e.replaceWith(t);
                              t.parentNode.insertBefore(document.createElement('br'), t);
                            });
                      document.getElementById('awc').appendChild(info);
                    });
    </script>`;

app.get('/', async (req, res) => {
    if (flights === null) {
        const { text } = await showFlights();
        flights = text;
    }
    let root = getRoot(req);
    res.set('Content-Type', 'text/html');
    res.write(htmlHeader);
    res.write(`<pre>${flights}</pre> \
        ${req.user ?
        `<form action="${root}/update" method="POST" style="display: inline-block;"> \
            <input type="submit" value="Update" onclick="this.disabled=true; this.value='Updating'; this.form.submit();" style="min-width: 20ex; min-height: 5ex;" /> \
        </form> \
        <form action="${root}/logout" method="POST" style="display: inline-block;"> \
            <input type="submit" value="Logout" style="min-height: 5ex;"/> \
        </form>` :
        `<form action="${root}/login" method="GET"><input type="submit" value="Login" style="min-height: 5ex;"/></form>`}`);
	res.write(awcInfo);
    res.end(htmlFooter);
});

app.get('/login', (req, res) => {
    res.set('Content-Type', 'text/html');
    res.write(htmlHeader);
    res.write('<form action="login" method="POST"><table> \
        <tr><td>Username:</td><td><input name="user"/></td></tr> \
        <tr><td>Password:</td><td><input name="password" type="password"/></td></tr> \
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
        res.redirect(`${root}/`);
        const accessToken = req.session.access_token;
        if (accessToken) {
            let rfc4122 = new RFC4122();
            const auth = new google.auth.OAuth2();
            auth.setCredentials({'access_token': accessToken});
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
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
    function(req, res) {
        req.session.access_token = req.user.accessToken;
        res.redirect('/');
    });


app.listen(port, () => {
    console.log(`listening at localhost:${port}`);
})
