const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><div id="tnb-google-search-input"></div>`);
console.log(dom.window.document.querySelector('#tnb-google-search-input') !== null);

const dom2 = new JSDOM(`<!DOCTYPE html><div id="tnb-google-search-input "></div>`);
console.log(dom2.window.document.querySelector('#tnb-google-search-input') !== null);
