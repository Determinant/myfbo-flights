#!/usr/bin/env node

const fs = require('fs');
const axios = require('axios').default;
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');
const jsdom = require("jsdom");
const moment = require('moment-timezone');

axiosCookieJarSupport(axios);
axios.defaults.withCredentials = true;
const { JSDOM } = jsdom;

const userAgent = "Mozilla/5.0 Chrome/89.0.4389.90 Mobile Safari/537.36";
const fbo = 'ehfc'; // change this to your local FBO id of MyFBO
const timezone = "America/New_York"; // change this to your location

const encodeForm = (data) => {
    return Object.keys(data)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
        .join('&');
}

async function showFlights() {
    const cookieJar = new tough.CookieJar();
    const password = fs.readFileSync(__dirname + "/.secret").toString().trim();
    const username = fs.readFileSync(__dirname + "/.username").toString().trim();
    await axios.get(`https://prod.myfbo.com/b/linkpage_mobile.asp?fbo=${fbo}`, {
        headers: { 'User-Agent': userAgent },
        jar: cookieJar,
        withCredentials: true
    });
    await axios
        .post('https://prod.myfbo.com/b/login_check.asp', encodeForm({
            'login': 'pda',
            'email': username,
            'password': password,
        }), {
            headers: {
                'User-Agent': userAgent,
                'Referer': `https://prod.myfbo.com/b/linkpage_mobile.asp?fbo=${fbo}`,
            },
            jar: cookieJar,
            withCredentials: true
        });
    const ret = await axios.get('https://prod.myfbo.com/ct/rsv_list.asp', {
        jar: cookieJar,
        withCredentials: true});
    const dom = new JSDOM(ret.data);
    const raw = dom.window.document.querySelector("input[name='msg']").value.split('\n');
    const records = [];
    const today = moment(new Date());
    let lessonToday = -1;
    raw.forEach((r, i) => {
        let m = r.match(' *\(.*\) beginning \(.*\) until \(.*\)');
        if (m) {
            const start = moment.tz(m[2], 'MM/DD/YY HH:mm', timezone);
            const end = moment.tz(m[3], 'MM/DD/YY HH:mm', timezone);
            if (start.isSame(today, 'day') ||
                end.isSame(today, 'day')) {
                lessonToday = records.length;
            }
            records.push({
                'entity': m[1],
                'start': start,
                'end': end
            });
        }
    });
    let res = '';
    const fmtTime = m => m.format("HH:mm", timezone);
    records.forEach(r => {
        res += `${r.entity}: ${r.start.format("MMM D YYYY")} [${fmtTime(r.start)}-${fmtTime(r.end)}]\n`;
        if (!r.entity.match('C1[57]2 .*')) {
            res += '\n';
        }
    });
    if (lessonToday >= 0) {
        const d = records[lessonToday];
        res += `!!! There is a lesson today: ${fmtTime(d.start)}-${fmtTime(d.end)}.\n`;
    } else {
        res += `No lesson today.\n`;
    }
    return res;
}

async function main() {
    console.log(await showFlights());
}

if (require.main === module) {
    main();
}

module.exports = {
    showFlights
}
