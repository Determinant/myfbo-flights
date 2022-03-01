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
//const fbo = 'ehfc';
const fbo = 'advantage'; // change this to your local FBO id of MyFBO/PaperlessFBO
const is_paperlessfbo = true; // change to false if it is MyFBO
//const timezone = "America/New_York";
const timezone = "America/Los_Angeles"; // change this to your location

const encodeForm = (data) => {
    return Object.keys(data)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
        .join('&');
}

async function showFlightsMyFBO() {
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
    const raw = dom.window.document.querySelector("input[name='msg']");
    if (!raw) {
        return '';
    }
    raw = raw.value.split('\n');
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
    return { text: res, records };
}

function get_state(data) {
    const dom = new JSDOM(data);
    let raw = dom.window.document.querySelector("input[name='__VIEWSTATEGENERATOR']");
    if (!raw) {
        return {};
    }
    const vsg = raw.value;
    raw = dom.window.document.querySelector("input[name='__VIEWSTATE']");
    if (!raw) {
        return {};
    }
    const vs = raw.value;
    return { vsg, vs };
}

async function showFlightsPaperlessFBO() {
    const cookieJar = new tough.CookieJar();
    const password = fs.readFileSync(__dirname + "/.secret").toString().trim();
    const username = fs.readFileSync(__dirname + "/.username").toString().trim();
    let ret = await axios.get(`https://${fbo}.paperlessfbo.com`, {
        jar: cookieJar,
        withCredentials: true});
    const s1 = get_state(ret.data);

    await axios
        .post(`https://${fbo}.paperlessfbo.com/`, encodeForm({
            'txtUserName': username,
            'txtPassword': password,
            'CheckRemember': 'on',
            'ButtLogin': 'Log In',
            '__VIEWSTATEGENERATOR': s1.vsg,
            '__VIEWSTATE': s1.vs,
        }), {
            headers: {
                'User-Agent': userAgent,
            },
            jar: cookieJar,
            withCredentials: true
        });
    ret = await axios.get(`https://${fbo}.paperlessfbo.com/mstr8.aspx`, {
        jar: cookieJar,
        withCredentials: true});
    const dom2 = new JSDOM(ret.data);
    const s2 = get_state(ret.data);
    const rows = dom2.window.document.getElementById("ctl00_ContentPlaceHolder1_GridView1").rows;
    if (!rows) {
        return '';
    }
    const records = [];
    let squawks = {};
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
        const entity = m[2].textContent;
        records.push({
            'entity': entity,
            'cfi': m[6].textContent,
            'start': start,
            'end': end,
        });
    }
    let res = '';
    const fmtTime = m => m.format("HH:mm", timezone);
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        res += `${i}. ${r.entity}: ${r.start.format("MMM DD YYYY")} [${fmtTime(r.start)}-${fmtTime(r.end)}] ${r.end.diff(r.start, 'hours')}h${r.cfi ? ' [' + r.cfi + ']' : ''}\n`;
        if (squawks[r.entity] === undefined) {
            squawks[r.entity] = await showSquawksPaperlessFBO(r.entity, s2, cookieJar);
        }
    }
    if (lessonToday >= 0) {
        const d = records[lessonToday];
        res += `!!! There is a lesson today: ${fmtTime(d.start)}-${fmtTime(d.end)}.\n`;
    } else {
        res += `No lesson today.\n`;
    }
    return { text: res, records, squawks };
}

async function showSquawksPaperlessFBO(tailNumber, state, cookieJar) {
    let ret = await axios.post(`https://${fbo}.paperlessfbo.com/mstr8.aspx`, encodeForm({
        '__LASTFOCUS': '',
        '__VIEWSTATEGENERATOR': state.vsg,
        '__VIEWSTATE': state.vs,
        '__EVENTTARGET': '',
        '__EVENTARGUMENT': '',
        'ctl00$CmdSquawks': 'Squawks',
    }), {
        jar: cookieJar,
        withCredentials: true});
    const s = get_state(ret.data);
    ret = await axios.post(`https://${fbo}.paperlessfbo.com/mstr4.aspx`, encodeForm({
        '__LASTFOCUS': '',
        '__VIEWSTATEGENERATOR': s.vsg,
        '__VIEWSTATE': s.vs,
        '__EVENTTARGET': 'ctl00$ContentPlaceHolder1$DropDownList1',
        '__EVENTARGUMENT': '',
        'ctl00$ContentPlaceHolder1$DropDownList1': tailNumber,
        'ctl00$txtEmail': 'tederminant@gmail.com',
    }), {
        headers: {
            'User-Agent': userAgent,
        },
        jar: cookieJar,
        withCredentials: true
    });
    const dom2 = new JSDOM(ret.data);
    let label = dom2.window.document.querySelector("#ctl00_ContentPlaceHolder1_Label4").nextSibling;
    let squawk = dom2.window.document.createElement('div');
    for (let i = 0; i < 8; i++) {
        const nlabel = label.nextElementSibling;
        squawk.append(label);
        label = nlabel;
    }
    squawk.querySelectorAll('br').forEach(e => e.remove());
    squawk.querySelectorAll('textarea').forEach(e => {
        let p = dom2.window.document.createElement('pre');
        p.innerHTML = e.value;
        e.replaceWith(p);
    });
    return squawk.innerHTML;
}


async function showFlights() {
    if (is_paperlessfbo) {
        return showFlightsPaperlessFBO();
    } else {
        return showFlightsMyFBO();
    }
}

async function main() {
    console.log(await showFlightsPaperlessFBO());
}

if (require.main === module) {
    main();
}

module.exports = {
    showFlights,
    fbo,
}
