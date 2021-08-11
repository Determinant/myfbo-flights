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
const timezone = "America/Los_Angeles"; // change this to your location

const encodeForm = (data) => {
    return Object.keys(data)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
        .join('&');
}

async function showFlights() {
    const cookieJar = new tough.CookieJar();
    const password = fs.readFileSync(__dirname + "/.secret").toString().trim();
    const username = fs.readFileSync(__dirname + "/.username").toString().trim();
    let ret = await axios.get('https://advantage.paperlessfbo.com', {
        jar: cookieJar,
        withCredentials: true});
    const dom = new JSDOM(ret.data);
    const vsg = dom.window.document.querySelector("input[name='__VIEWSTATEGENERATOR']").value;
    const vs = dom.window.document.querySelector("input[name='__VIEWSTATE']").value;

    await axios
        .post('https://advantage.paperlessfbo.com/', encodeForm({
            'txtUserName': username,
            'txtPassword': password,
            'CheckRemember': 'on',
            'ButtLogin': 'Log In',
            '__VIEWSTATEGENERATOR': vsg,
            '__VIEWSTATE': vs,
        }), {
            headers: {
                'User-Agent': userAgent,
            },
            jar: cookieJar,
            withCredentials: true
        });
    ret = await axios.get('https://advantage.paperlessfbo.com/mstr8.aspx', {
        jar: cookieJar,
        withCredentials: true});
    const dom2 = new JSDOM(ret.data);
    const rows = dom2.window.document.getElementById("ctl00_ContentPlaceHolder1_GridView1").rows;
    const records = [];
    const today = moment(new Date());
    let lessonToday = -1;
    for (let i = 1; i < rows.length; i++) {
        const m = rows[i].cells;
        const start = moment.tz(m[3].textContent, 'M/D/YYYY HH:mm:SS A', timezone);
        const end = moment.tz(m[4].textContent, 'M/D/YYYY HH:mm:SS A', timezone);
        if (start.isSame(today, 'day') ||
            end.isSame(today, 'day')) {
            lessonToday = records.length;
        }
        records.push({
            'entity': m[2].textContent,
            'start': start,
            'end': end
        });
    }
    let res = '';
    const fmtTime = m => m.format("HH:mm", timezone);
    records.forEach(r => {
        res += `${r.entity}: ${r.start.format("MMM D YYYY")} [${fmtTime(r.start)}-${fmtTime(r.end)}]\n`;
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
