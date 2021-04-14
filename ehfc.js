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
const timezone = "America/New_York";

const encodeForm = (data) => {
    return Object.keys(data)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
        .join('&');
}

async function main() {
    const cookieJar = new tough.CookieJar();
    const password = fs.readFileSync(__dirname + "/.secret").toString().trim();
    await axios.get('https://prod.myfbo.com/b/linkpage_mobile.asp?fbo=ehfc', {
        headers: { 'User-Agent': userAgent },
        jar: cookieJar,
        withCredentials: true
    });
    await axios
        .post('https://prod.myfbo.com/b/login_check.asp', encodeForm({
            'login': 'pda',
            'email': 'tederminant@gmail.com',
            'password': password,
        }), {
            headers: {
                'User-Agent': userAgent,
                'Referer': 'https://prod.myfbo.com/b/linkpage_mobile.asp?fbo=ehfc',
            },
            jar: cookieJar,
            withCredentials: true
        });
    const res = await axios.get('https://prod.myfbo.com/ct/rsv_list.asp', {
        jar: cookieJar,
        withCredentials: true});
    const dom = new JSDOM(res.data);
    const raw = dom.window.document.querySelector("input[name='msg']").value.split('\n');
    const records = [];
    const today = moment(new Date());
    let lessonToday = -1;
    raw.forEach((r, i) => {
        let m = r.match(' *\(.*\) beginning \(.*\) until \(.*\)');
        if (m) {
            const start = moment.tz(m[2], 'MM/DD/YY HH:mm', timezone);
            const end = moment.tz(m[3], 'MM/DD/YY HH:mm', timezone);
            if (today.isSame(start, 'day') ||
                today.isSame(end, 'day')) {
                lessonToday = i;
            }
            records.push({
                'entity': m[1],
                'start': start,
                'end': end
            });
        }
    });
    const fmtTime = m => m.format("HH:mm", timezone);
    records.forEach(r => {
        console.log(`${r.entity}: ${r.start.format("MMM D YYYY")} [${fmtTime(r.start)}-${fmtTime(r.end)}]`);
        if (!r.entity.match('C1[57]2 .*')) {
            console.log();
        }
    });
    if (lessonToday >= 0) {
        const d = records[lessonToday];
        console.log(`!!! There is a lesson today: ${fmtTime(d.start)}-${fmtTime(d.end)}.`);
    } else {
        console.log("No lesson today.");
    }
}

main();
