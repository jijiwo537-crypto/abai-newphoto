import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';
const simplify = OpenCC.Converter({ from: 'tw', to: 'cn' });
const overrides = { '修圖':'修图','儲存':'保存','儲存中':'保存中','復原':'撤销','重做':'重做','遮色片':'蒙版','佈局':'布局','帳號':'账号','影片':'视频','透明度':'不透明度','我的':'我的','美顏':'美颜','仿色':'色彩匹配','正在儲存草稿':'正在保存草稿','是否儲存為草稿':'是否保存为草稿','歷史紀錄':'历史记录','匯入照片':'导入照片','匯入圖片':'导入图片','匯入影片':'导入视频','儲存圖片':'保存图片','儲存影片':'保存视频','登入':'登录','立即登入':'立即登录','輸入文字':'输入文字','加入':'添加' };
const rows=fs.readFileSync('locales/copy.tsv','utf8').trimEnd().split('\n').slice(1).map(l=>l.split('\t').map(s=>s.replaceAll('\\n','\n')));
const catalog={};
for(const [zh,en,ja,ko] of rows){ if(!zh||!en||!ja||!ko)throw Error('Incomplete: '+zh); if(catalog[zh])throw Error('Duplicate: '+zh); catalog[zh]={'zh-Hans':overrides[zh]||simplify(zh).replaceAll('储存','保存').replaceAll('汇入','导入').replaceAll('影片','视频').replaceAll('遮色片','蒙版').replaceAll('登入','登录').replaceAll('设定','设置').replaceAll('联络','联系').replaceAll('视窗','窗口'),ja,ko,en}; }
const files={'utils/translations.json':JSON.stringify(catalog,null,2)+'\n'};
for(const [lang,label] of [['zh-Hans','簡體中文'],['ja','日文'],['ko','韓文'],['en','英文']]){
 files[`public/translations/${lang}.md`]=`# ABAI ${label}對照表\n\n介面字串；作品文字、符號與字體名稱不翻譯。\n\n| 繁體中文 | ${label} |\n|---|---|\n`+Object.entries(catalog).map(([zh,v])=>`| ${zh.replaceAll('|','\\|').replaceAll('\n','<br>')} | ${v[lang].replaceAll('|','\\|').replaceAll('\n','<br>')} |`).join('\n')+'\n';
}
// Print an apply_patch patch instead of silently rewriting source files.
console.log('*** Begin Patch');
for(const [file,text] of Object.entries(files)){
 if(fs.existsSync(file)){
   console.log('*** Update File: '+path.resolve(file)+'\n@@');
   console.log(fs.readFileSync(file,'utf8').trimEnd().split('\n').map(l=>'-'+l).join('\n'));
 } else console.log('*** Add File: '+path.resolve(file));
 console.log(text.trimEnd().split('\n').map(l=>'+'+l).join('\n'));
}
console.log('*** End Patch');
