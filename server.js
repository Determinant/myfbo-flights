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
const { showFlights } = require('./flights.js');

const port = 8080;
const admin = {id: '42', email: 'ymf', password: 'ymf_ymf'};

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

app.get('/', async (req, res) => {
    if (flights === null) {
        flights = await showFlights();
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
    res.end(htmlFooter);
});

app.get('/login', (req, res) => {
    res.set('Content-Type', 'text/html');
    res.write(htmlHeader);
    res.write('<form action="login" method="POST"><table> \
        <tr><td>Username:</td><td><input name="user"/></td></tr> \
        <tr><td>Password:</td><td><input name="password"/></td></tr> \
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
        flights = await showFlights();
        res.redirect(`${root}/`);
    } else {
        res.redirect(`${root}/login`);
    }
    res.end();
});

app.listen(port, () => {
    console.log(`listening at localhost:${port}`);
})
