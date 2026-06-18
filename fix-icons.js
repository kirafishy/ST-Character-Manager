const fs = require('fs');
let file = fs.readFileSync('constants.js', 'utf-8');
if (!file.includes('ai:')) {
    file = file.replace('export const ICONS = {', "export const ICONS = {\r\n    ai: '<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z\"></path><path d=\"m14 7 3 3\"></path><path d=\"M5 6v4\"></path><path d=\"M19 14v4\"></path><path d=\"M10 2v2\"></path><path d=\"M7 8H3\"></path><path d=\"M21 16h-4\"></path><path d=\"M11 3H9\"></path></svg>',");
    fs.writeFileSync('constants.js', file);
    console.log('Added ai icon');
}
