/**
 * 文字圖層可用的字體。
 *
 * 首頁背景預載範例字元，文字編輯器再提前載入目前文字的字元子集。
 * 有限併發避免 CJK 字體下載搶走開場動畫及操作的資源。
 *
 * 每一類都把最常用的排在前面，並盡量避開長得幾乎一樣的家族。
 */

import { t } from './locale';
import { FONT_PREVIEW_INDEX } from './fontPreviewIndex';
import { isFontDownloaded, loadStoredFont, downloadFont, type FontSource } from './fontStore';
export type FontCategory = 'zh' | 'en' | 'ja' | 'ko';

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'zh', label: t('中文') },
  { id: 'en', label: t('英文') },
  { id: 'ja', label: t('日文') },
  { id: 'ko', label: t('韓文') },
];

/** 每個字體要預覽的範例字，用該語言自己的字才看得出差別。 */
export const FONT_SAMPLE: Record<FontCategory, string> = {
  zh: '阿白',
  en: 'ABAI',
  ja: 'みかん',
  ko: '오렌지',
};

export interface FontDef {
  /** CSS font-family 名稱，同時也是 Google Fonts 的家族名 */
  name: string;
  category: FontCategory;
  /** 顯示用的中文別名 */
  label: string;
}

const zh: [string, string][] = [
  // 風格輪流出現（黑體、明體、圓體、楷書手寫、標題、特殊…各一個為一輪），每一類裡最好看最常用的先出現；長得像的不會擠在一起。只有簡體字身的（簡）整組排在最後
  ['Noto Sans TC', '思源黑體'],
  ['Noto Serif TC', '思源宋體'],
  ['Huninn', '粉圓體'],
  ['LXGW WenKai TC', '霞鶩文楷'],
  ['LogoSC LongZhuTi', '標小智龍珠體'],
  ['Cubic 11', '俐方體 11 號'],
  ['Chocolate Classical Sans', '巧克力黑體'],
  ['Cactus Classical Serif', '仙人掌明體'],
  ['Zen Maru Gothic', '圓體'],
  ['LXGW Bright', '霞鶩晰明'],
  ['STDongGuanTi', '上圖東觀體'],
  ['MuzaiPixel', '木仔像素體'],
  ['Chiron Hei HK', '昭源黑體'],
  ['GenWanMin TC', '源雲明體'],
  ['Chiron GoRound TC', '昭源圓體'],
  ['Iansui', '芫荽'],
  ['QuanPixel 8px', '泉像素'],
  ['CEF Fonts CJK', 'CEF 全字庫黑'],
  ['Chiron Sung HK', '昭源宋體'],
  ['寒蝉全圆体', '寒蟬全圓體'],
  ['GuanKiapTsingKhai', '原俠正楷'],
  ['LXGW WenKai Mono TC', '霞鶩文楷 等寬'],
  ['Xiaohe Simplify Sans VF', '小荷黑體'],
  ['Noto Serif HK', '思源宋體 香港'],
  ['MaokenZhuyuanTi', '貓啃珠圓體'],
  ['GuanKiapTsingKhai-TW', '原俠正楷 台灣'],
  ['Maple Mono CN', 'Maple 等寬'],
  ['MaokenAssortedSans', '貓啃什錦黑'],
  ['LXGW Neo ZhiSong', '霞鶩新致宋'],
  ['Yozai', '悠哉體'],
  ['GuanKiapTsingKhai-T', '原俠正楷 T'],
  ['Bpmf Huninn', '粉圓 注音'],
  ['LXGW Marker Gothic', '霞鶩漫黑'],
  ['Source Han Serif CN VF', '思源宋體（可變）'],
  ['Xiaolai SC', '小賴體'],
  ['Moon Stars Kai', '月星楷'],
  ['Bpmf Iansui', '芫荽 注音'],
  ['WDXL Lubrifont TC', 'WDXL 滑油字'],
  ['Source Han Serif CN for Display', '思源屏顯臻宋'],
  ['I.Ngaan', '一點眼'],
  ['Moon Stars Kai T', '月星楷 T'],
  ['Bpmf Zihi Kai Std', '字嗨楷 注音'],
  ['Xiaohe Simplify Serif VF', '小荷宋體'],
  ['ToneOZ-Tsuipita-TC', '童喔翠筆'],
  ['Huiwen-mincho', '匯文明朝體'],
  ['ChenYuluoyan', '辰宇落雁'],
  ['极影毁片文宋 Medium', '極影毀片文宋'],
  ['The Peak Font 隨峰體 Beta', '隨峰體'],
  ['SoukouMincho', '裝甲明朝體'],
  ['UoqMunThenKhung', '有感文典宮'],
  ['QIJIFALLBACK', '齊伋體'],
  ['Noto Sans SC', '思源黑體 簡（簡）'],
  ['Noto Serif SC', '思源宋體 簡（簡）'],
  ['ZCOOL KuaiLe', '站酷快樂體（簡）'],
  ['Ma Shan Zheng', '馬善政毛筆（簡）'],
  ['YouSheBiaoTiHei', '優設標題黑（簡）'],
  ['PangMenZhengDao-XiXian', '龐門正道細線體（簡）'],
  ['Smiley Sans Oblique', '得意黑（簡）'],
  ['FlyFlowerSong', '飛花宋體（簡）'],
  ['MaoKenTangYuan (beta)', '貓啃網糖圓（簡）'],
  ['Zhi Mang Xing', '志莽行書（簡）'],
  ['DOUYU Font', '斗魚追光體（簡）'],
  ['峄山碑篆体', '嶧山碑篆體（簡）'],
  ['Douyin Sans', '抖音美好體（簡）'],
  ['Zhuque Fangsong (technical preview)', '朱雀仿宋（簡）'],
  ['PING FANG MENG MNEG DA', '平方萌萌噠（簡）'],
  ['Long Cang', '龍藏體（簡）'],
  ['TsangerZhoukeZhengdabangshu', '倉耳周珂正大榜書（簡）'],
  ['WDXL Lubrifont SC', 'WDXL 滑油字 簡（簡）'],
  ['nzgrKangxi', '康熙字典美化體（簡）'],
  ['zihunbiantaoti', '字魂扁桃體（簡）'],
  ['Liu Jian Mao Cao', '流江毛草（簡）'],
  ['YunFengchongqingbangbangti', '雲峰山城棒棒體（簡）'],
  ['YEFONTXiaoShiTou', '也字工廠小石頭（簡）'],
  ['hongleixingshu', '鴻雷行書（簡）'],
  ['huangyinqi zhaopai', '黃引齊招牌體（簡）'],
  ['ZoomlaMengyas-A080', '逐浪萌芽字（簡）'],
  ['瑞美加张清平硬笔行书', '張清平硬筆行書（簡）'],
  ['荆南俊俊体', '荊南俊俊體（簡）'],
  ['FontQu Smile 常规', '字制區喜脈體（簡）'],
  ['qiantubifengshouxieti', '千圖筆鋒手寫體（簡）'],
  ['PING FANG GONG ZI TI', '平方公子體（簡）'],
  ['BWCKKT', '白無常可可體（簡）'],
  ['bailubangbangshouxieti', '白路棒棒手寫體（簡）'],
  ['SuCaiJiShi-SheHuiTi', '素材集市社會體（簡）'],
  ['快看世界体', '快看世界體（簡）'],
  ['jiangxizhuokai', '江西拙楷（簡）'],
  ['YouSheShaYuFeiTeJianKangTi', '優設鯊魚菲特體（簡）'],
  ['chengrongguangke', '程榮光刻楷（簡）'],
  ['shetumodengxiaofangti', '攝圖摩登小方體（簡）'],
  ['XuandongKaishu', '玄冬楷書（簡）'],
  ['ZCOOL QingKe HuangYou', '站酷慶科黃油（簡）'],
  ['nzgrRuYinZouZhangKai', '如印奏章楷（簡）'],
  ['ZCOOL XiaoWei', '站酷小薇（簡）'],
  ['YuFanXinYu', '余繁新語（簡）'],
  ['xiaowei', '站酷小薇體（簡）'],
  ['平方赖江湖飞扬体', '平方賴江湖飛揚體（簡）'],
  ['Slidefu', '演示佛系體（簡）'],
  ['平方赖江湖琅琊体', '平方賴江湖琅琊體（簡）'],
];

const en: [string, string][] = [
  // 風格輪流出現（黑體、明體、圓體、楷書手寫、標題、特殊…各一個為一輪），每一類裡最好看最常用的先出現；長得像的不會擠在一起
  ['Montserrat', 'Montserrat'],
  ['Playfair Display', 'Playfair Display'],
  ['Great Vibes', 'Great Vibes'],
  ['Caveat', 'Caveat'],
  ['Bebas Neue', 'Bebas Neue'],
  ['Orbitron', 'Orbitron'],
  ['Monoton', 'Monoton'],
  ['Press Start 2P', 'Press Start 2P'],
  ['Raleway', 'Raleway'],
  ['DM Serif Display', 'DM Serif Display'],
  ['Dancing Script', 'Dancing Script'],
  ['Caveat Brush', 'Caveat Brush'],
  ['Anton', 'Anton'],
  ['Audiowide', 'Audiowide'],
  ['Bungee Shade', 'Bungee Shade'],
  ['Silkscreen', 'Silkscreen'],
  ['Josefin Sans', 'Josefin Sans'],
  ['Lora', 'Lora'],
  ['Pacifico', 'Pacifico'],
  ['Permanent Marker', 'Permanent Marker'],
  ['Archivo Black', 'Archivo Black'],
  ['Oxanium', 'Oxanium'],
  ['Megrim', 'Megrim'],
  ['Pixelify Sans', 'Pixelify Sans'],
  ['Quicksand', 'Quicksand'],
  ['Merriweather', 'Merriweather'],
  ['Lobster', 'Lobster'],
  ['Shadows Into Light', 'Shadows Into Light'],
  ['Alfa Slab One', 'Alfa Slab One'],
  ['Goldman', 'Goldman'],
  ['Plaster', 'Plaster'],
  ['Courier Prime', 'Courier Prime'],
  ['Comfortaa', 'Comfortaa'],
  ['Libre Baskerville', 'Libre Baskerville'],
  ['Lobster Two', 'Lobster Two'],
  ['Indie Flower', 'Indie Flower'],
  ['Titan One', 'Titan One'],
  ['Tektur', 'Tektur'],
  ['Rubik Glitch', 'Rubik Glitch'],
  ['JetBrains Mono', 'JetBrains Mono'],
  ['Space Grotesk', 'Space Grotesk'],
  ['EB Garamond', 'EB Garamond'],
  ['Satisfy', 'Satisfy'],
  ['Patrick Hand', 'Patrick Hand'],
  ['Lilita One', 'Lilita One'],
  ['Funnel Display', 'Funnel Display'],
  ['Creepster', 'Creepster'],
  ['IBM Plex Mono', 'IBM Plex Mono'],
  ['DM Sans', 'DM Sans'],
  ['Cormorant Garamond', 'Cormorant Garamond'],
  ['Allura', 'Allura'],
  ['Handlee', 'Handlee'],
  ['Luckiest Guy', 'Luckiest Guy'],
  ['MuseoModerno', 'MuseoModerno'],
  ['Pirata One', 'Pirata One'],
  ['Outfit', 'Outfit'],
  ['Spectral', 'Spectral'],
  ['Alex Brush', 'Alex Brush'],
  ['Gochi Hand', 'Gochi Hand'],
  ['Bangers', 'Bangers'],
  ['Coda', 'Coda'],
  ['UnifrakturMaguntia', 'UnifrakturMaguntia'],
  ['Jost', 'Jost'],
  ['Vollkorn', 'Vollkorn'],
  ['Parisienne', 'Parisienne'],
  ['Architects Daughter', 'Architects Daughter'],
  ['Bungee', 'Bungee'],
  ['Faster One', 'Faster One'],
  ['Rye', 'Rye'],
  ['Rubik', 'Rubik'],
  ['Bitter', 'Bitter'],
  ['Pinyon Script', 'Pinyon Script'],
  ['Gloria Hallelujah', 'Gloria Hallelujah'],
  ['Bowlby One', 'Bowlby One'],
  ['Chelsea Market', 'Chelsea Market'],
  ['Nunito', 'Nunito'],
  ['Roboto Slab', 'Roboto Slab'],
  ['Tangerine', 'Tangerine'],
  ['Reenie Beanie', 'Reenie Beanie'],
  ['Bowlby One SC', 'Bowlby One SC'],
  ['Special Elite', 'Special Elite'],
  ['Manrope', 'Manrope'],
  ['Cinzel', 'Cinzel'],
  ['Italianno', 'Italianno'],
  ['Nothing You Could Do', 'Nothing You Could Do'],
  ['Passion One', 'Passion One'],
  ['Archivo', 'Archivo'],
  ['Cinzel Decorative', 'Cinzel Decorative'],
  ['Sacramento', 'Sacramento'],
  ['Annie Use Your Telescope', 'Annie Use Your Telescope'],
  ['Changa One', 'Changa One'],
  ['Barlow', 'Barlow'],
  ['Marcellus', 'Marcellus'],
  ['Mrs Saint Delafield', 'Mrs Saint Delafield'],
  ['Just Another Hand', 'Just Another Hand'],
  ['Fugaz One', 'Fugaz One'],
  ['Ubuntu', 'Ubuntu'],
  ['Forum', 'Forum'],
  ['Ms Madi', 'Ms Madi'],
  ['Rock Salt', 'Rock Salt'],
  ['Carter One', 'Carter One'],
  ['Gabarito', 'Gabarito'],
  ['Yeseva One', 'Yeseva One'],
  ['Mr Dafoe', 'Mr Dafoe'],
  ['Amatic SC', 'Amatic SC'],
  ['Calistoga', 'Calistoga'],
  ['Oswald', 'Oswald'],
  ['Abril Fatface', 'Abril Fatface'],
  ['Yellowtail', 'Yellowtail'],
  ['Neucha', 'Neucha'],
  ['Caprasimo', 'Caprasimo'],
  ['Fredoka', 'Fredoka'],
  ['Gravitas One', 'Gravitas One'],
  ['Cookie', 'Cookie'],
  ['Delius', 'Delius'],
  ['Chango', 'Chango'],
  ['Balsamiq Sans', 'Balsamiq Sans'],
  ['Averia Serif Libre', 'Averia Serif Libre'],
  ['Damion', 'Damion'],
  ['Comic Neue', 'Comic Neue'],
  ['Rammetto One', 'Rammetto One'],
  ['Aboreto', 'Aboreto'],
  ['Playball', 'Playball'],
  ['Pangolin', 'Pangolin'],
  ['Concert One', 'Concert One'],
  ['Poiret One', 'Poiret One'],
  ['Kaushan Script', 'Kaushan Script'],
  ['Playpen Sans', 'Playpen Sans'],
  ['Patua One', 'Patua One'],
  ['Courgette', 'Courgette'],
  ['Merienda', 'Merienda'],
  ['Righteous', 'Righteous'],
  ['Marck Script', 'Marck Script'],
  ['Grandstander', 'Grandstander'],
  ['Staatliches', 'Staatliches'],
  ['Bad Script', 'Bad Script'],
  ['Big Shoulders', 'Big Shoulders'],
  ['Oleo Script', 'Oleo Script'],
  ['Squada One', 'Squada One'],
  ['Berkshire Swash', 'Berkshire Swash'],
  ['Unica One', 'Unica One'],
  ['Sofia', 'Sofia'],
  ['Londrina Solid', 'Londrina Solid'],
  ['Cedarville Cursive', 'Cedarville Cursive'],
  ['Chewy', 'Chewy'],
  ['Oooh Baby', 'Oooh Baby'],
  ['Knewave', 'Knewave'],
  ['Homemade Apple', 'Homemade Apple'],
  ['Racing Sans One', 'Racing Sans One'],
  ['Zeyada', 'Zeyada'],
  ['Rowdies', 'Rowdies'],
  ['Black Ops One', 'Black Ops One'],
  ['Stardos Stencil', 'Stardos Stencil'],
];

const ja: [string, string][] = [
  // 風格輪流出現（黑體、明體、圓體、楷書手寫、標題、特殊…各一個為一輪），每一類裡最好看最常用的先出現；長得像的不會擠在一起
  ['Noto Sans JP', 'ノトサンス'],
  ['Noto Serif JP', 'ノト明朝'],
  ['M PLUS Rounded 1c', '丸ゴシック'],
  ['Klee One', 'クレー'],
  ['Dela Gothic One', 'デラゴシック'],
  ['DotGothic16', 'ドットゴシック'],
  ['Zen Kaku Gothic New', 'ゼン角ゴシック'],
  ['Shippori Mincho', 'しっぽり明朝'],
  ['Zen Maru Gothic', 'ゼン丸ゴシック'],
  ['Yomogi', 'よもぎ'],
  ['Potta One', 'ポッタ'],
  ['Palette Mosaic', 'パレットモザイク'],
  ['M PLUS 1p', 'M PLUS 1p'],
  ['Shippori Mincho B1', 'しっぽり明朝 B1'],
  ['Kosugi Maru', '小杉丸'],
  ['Zen Kurenaido', 'ゼン紅道'],
  ['RocknRoll One', 'ロックンロール'],
  ['M PLUS 1 Code', 'M PLUS コード'],
  ['M PLUS 1', 'M PLUS 1'],
  ['Zen Old Mincho', 'ゼン明朝'],
  ['Kiwi Maru', 'キウイ丸'],
  ['Yusei Magic', '游星マジック'],
  ['Reggae One', 'レゲエ'],
  ['WDXL Lubrifont JP N', 'WDXL 潤滑'],
  ['M PLUS 2', 'M PLUS 2'],
  ['Sawarabi Mincho', 'さわらび明朝'],
  ['Tsukimi Rounded', '月見丸'],
  ['Yuji Syuku', '佑字 肅'],
  ['Rampart One', 'ランパート'],
  ['LINE Seed JP', 'LINE Seed'],
  ['BIZ UDPMincho', 'BIZ UD 明朝'],
  ['Mochiy Pop One', 'もちぃポップ'],
  ['Yuji Boku', '佑字 木'],
  ['Train One', 'トレイン'],
  ['BIZ UDPGothic', 'BIZ UD ゴシック'],
  ['BIZ UDMincho', 'BIZ UD明朝 等幅'],
  ['Mochiy Pop P One', 'もちぃポップ P'],
  ['Yuji Mai', '佑字 舞'],
  ['Darumadrop One', 'だるまドロップ'],
  ['IBM Plex Sans JP', 'IBM Plex JP'],
  ['Hina Mincho', 'ひな明朝'],
  ['Hachi Maru Pop', 'はちまるポップ'],
  ['Slackside One', 'スラックサイド'],
  ['Cherry Bomb One', 'チェリーボム'],
  ['Murecho', 'ムレチョ'],
  ['Kaisei Opti', '解星オプティ'],
  ['Yuji Hentaigana Akari', '変体仮名 あかり'],
  ['Monomaniac One', 'モノマニアック'],
  ['Sawarabi Gothic', 'さわらびゴシック'],
  ['Kaisei Tokumin', '解星 特ミン'],
  ['Yuji Hentaigana Akebono', '変体仮名 あけぼの'],
  ['Stick', 'スティック'],
  ['Kosugi', '小杉ゴシック'],
  ['Kaisei Decol', '解星デコール'],
  ['Shizuru', 'しずる'],
  ['Zen Kaku Gothic Antique', 'ゼン角ゴシック古'],
  ['Kaisei HarunoUmi', '解星 春の海'],
  ['Chokokutai', '彫刻体'],
  ['M PLUS U', 'M PLUS U'],
  ['Zen Antique', 'ゼンアンティーク'],
  ['BIZ UDGothic', 'BIZ UDゴシック 等幅'],
  ['Zen Antique Soft', 'ゼンアンティーク軟'],
  ['Shippori Antique', 'しっぽりアンティーク'],
  ['Shippori Antique B1', 'しっぽりアンティーク B1'],
  ['New Tegomin', 'ニューテゴミン'],
  ['Aoboshi One', '青星'],
];

const ko: [string, string][] = [
  // 風格輪流出現（黑體、明體、圓體、楷書手寫、標題、特殊…各一個為一輪），每一類裡最好看最常用的先出現；長得像的不會擠在一起
  ['Noto Sans KR', '노토 산스'],
  ['Noto Serif KR', '노토 세리프'],
  ['Jua', '주아'],
  ['Nanum Pen Script', '나눔손글씨 펜'],
  ['Black Han Sans', '검은고딕'],
  ['Gugi', '구기'],
  ['Nanum Gothic', '나눔고딕'],
  ['Nanum Myeongjo', '나눔명조'],
  ['Dongle', '동글'],
  ['Nanum Brush Script', '나눔손글씨 붓'],
  ['Do Hyeon', '도현'],
  ['Black And White Picture', '흑백사진'],
  ['Gothic A1', '고딕 A1'],
  ['Gowun Batang', '고운바탕'],
  ['KR CookieRun-Regular', '쿠키런'],
  ['Gaegu', '개구'],
  ['KR JalnanGothic', '잘난고딕'],
  ['KR Giants-Inline', '롯데 자이언츠 인라인'],
  ['IBM Plex Sans KR', 'IBM Plex Sans KR'],
  ['Song Myung', '송명'],
  ['KR MaplestoryOTFBold', '메이플스토리'],
  ['Gamja Flower', '감자꽃'],
  ['KR SBAggroB', '어그로체'],
  ['KR neodgm', 'Neo 둥근모'],
  ['KR SUIT-Bold', 'SUIT'],
  ['Hahmlet', '함렛'],
  ['KR Bazzi', '배찌체'],
  ['Hi Melody', '하이멜로디'],
  ['KR PartialSansKR-Regular', '파셜 산스'],
  ['KR PFStardust', 'PF 스타더스트'],
  ['KR LINESeedKR-Rg', 'LINE Seed KR'],
  ['Diphylleia', '디필레이아'],
  ['KR Binggrae-Bold', '빙그레체'],
  ['Poor Story', '푸어스토리'],
  ['Gasoek One', '가석'],
  ['KR pixelroborobo', '픽셀 로보로보'],
  ['KR Paperlogy-4Regular', '페이퍼로지'],
  ['Grandiflora One', '그랜디플로라'],
  ['KR HSJiptokki-Round', 'HS 집토끼'],
  ['Single Day', '싱글데이'],
  ['Bagel Fat One', '베이글'],
  ['Nanum Gothic Coding', '나눔고딕코딩'],
  ['KR GmarketSansBold', '지마켓 산스'],
  ['KR YiSunShinRegular', '이순신체'],
  ['KR Cafe24Moyamoya-Regular-v1.0', '카페24 모야모야'],
  ['East Sea Dokdo', '동해독도'],
  ['KR BABAOTF', '바바체'],
  ['Asta Sans', '아스타 산스'],
  ['KR HeirofLightOTFBold', '빛의 계승자'],
  ['KR insungitCutelivelyjisu', '귀여운 지수체'],
  ['Dokdo', '독도'],
  ['KR Cafe24Dangdanghae', '카페24 당당해'],
  ['Orbit', '오빗'],
  ['KR GimpoTitle00', '김포 제목'],
  ['KR ghanachoco', '가나초콜릿'],
  ['KR KyoboHand', '교보 손글씨'],
  ['KR Cafe24Ohsquare', '카페24 아네모네'],
  ['Gowun Dodum', '고운돋움'],
  ['KR TmonMonsori', '티몬 몬소리'],
  ['KR ShinDongYupHandwriting-R', '신동엽 손글씨'],
  ['KR GangwonEduPowerExtraBoldA', '강원교육 튼튼'],
  ['KR NEXON Lv1 Gothic OTF Bold', '넥슨 Lv1 고딕'],
  ['Cute Font', '큐트'],
  ['KR Ownglyph_jooreeletter-Rg', '온글잎 주리편지'],
  ['KR LOTTERIACHAB', '롯데리아 촵땡겨'],
  ['KR ThecircleM', '더서클'],
  ['KR cachildrenkkum', '어린이 꿈'],
  ['KR drfont_daraehand', '다래손글씨'],
  ['KR Ansungtangmyun-Bold', '안성탕면체'],
  ['KR designhouseOTFLight00', '디자인하우스'],
  ['KR KNPSKkomi-Regular00', '국립공원 꼬미'],
  ['KR LeeHyunJi', '이현지체'],
  ['KR SDKukdetopokki-aLt00', '국대떡볶이'],
  ['Sunflower', '해바라기'],
  ['KR OKCHAN', '오케이찬'],
  ['KR UhBeeZZIBA-Regular', '어비 찌바'],
  ['KR KCC-Ganpan', 'KCC 간판체'],
  ['Stylish', '스타일리시'],
  ['KR Dolbomche_R', '돌봄체'],
  ['KR ImcreSoojin', '임크리 수진'],
  ['KR KCCChassam', 'KCC 차쌈'],
  ['KR YanoljaYacheR', '야놀자 야체'],
  ['KR snByulByul', '별별체'],
  ['KR CWDangamAsac-Bold', '당감 아삭'],
  ['KR SangSangFlowerRoad', '상상 꽃길'],
  ['KR NapjakBlock', '납작블럭'],
  ['KR MapoFlowerIslandA', '마포 꽃섬'],
  ['KR Swagger', '스웨거체'],
  ['KR MapoDacapoA', '마포 다카포'],
  ['KR DWImpactamin', '임팩타민'],
  ['KR MapoBackpackingA', '마포 배낭여행'],
  ['KR ROKABold', '육군체'],
  ['KR YUN-BONG-GIL', '윤봉길체'],
  ['KR NEXONFootballGothicBA1', '넥슨 풋볼고딕'],
  ['KR YunTaemin', '윤태민체'],
  ['KR KOTRAHOPE', '코트라 희망'],
  ['Yeon Sung', '연성'],
  ['KR YES24', 'YES24체'],
  ['Kirang Haerang', '기랑해랑'],
  ['KR HSSaemaul-Regular', 'HS 새마을'],
  ['KR MapoGoldenPierA', '마포 황금나루'],
  ['KR Recipekorea', '레시피코리아'],
  ['KR LeferiPoint-SpecialA', '레페리 포인트'],
  ['KR Dovemayo_wild', '도브메이오 와일드'],
  ['KR CHOGOONCHICKENSCRATCHV5', '초군 치킨'],
  ['KR TAEBAEKmilkyway', '태백 은하수'],
  ['KR YeongdeokSea', '영덕 바다'],
  ['Hangeuljaemin4.0', '한글재민체'],
];

export const FONTS: FontDef[] = [
  ...zh.map(([name, label]) => ({ name, label, category: 'zh' as const })),
  ...en.map(([name, label]) => ({ name, label, category: 'en' as const })),
  ...ja.map(([name, label]) => ({ name, label, category: 'ja' as const })),
  ...ko.map(([name, label]) => ({ name, label, category: 'ko' as const })),
];

export const DEFAULT_FONT = 'Noto Sans TC';
/** 符號要與 iPhone 直接輸入時一致：先走 Apple 系統字體，再由系統自行 fallback。 */
export const SYMBOL_FONT = 'PingFang TC';

const requested = new Map<string, Promise<void>>();
/** CSS 已經下載完的家族。要「同步」知道能不能直接量字寬時用。 */
const cssDone = new Set<string>();
const EXTRA_FONT_URLS: Record<string, string> = {
  'Cubic 11': 'https://cdn.jsdelivr.net/gh/ACh-K/Cubic-11@main/fonts/web/Cubic_11.woff2',
  'ChenYuluoyan': 'https://cdn.jsdelivr.net/gh/Chenyu-otf/chenyuluoyan_thin@main/ChenYuluoyan-2.0-Thin.ttf',
  'GenWanMin TC': 'https://raw.githubusercontent.com/ButTaiwan/genwan-font/master/otf/TC/GenWanMin2TC-R.otf',
  "KR GmarketSansBold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/GmarketSansBold.woff",
  "KR CookieRun-Regular": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/CookieRun-Regular.woff",
  "KR BABAOTF": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/BABAOTF.woff",
  "KR Cafe24Dangdanghae": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/Cafe24Dangdanghae.woff",
  "KR Cafe24Ohsquare": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/Cafe24Ohsquare.woff",
  "KR HeirofLightOTFBold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/HeirofLightOTFBold.woff",
  "KR MapoFlowerIslandA": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/MapoFlowerIslandA.woff",
  "KR MapoGoldenPierA": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/MapoGoldenPierA.woff",
  "KR MapoBackpackingA": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/MapoBackpackingA.woff",
  "KR MapoDacapoA": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/MapoDacapoA.woff",
  "KR neodgm": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/neodgm.woff",
  "KR PFStardust": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/PFStardust.woff",
  "KR Recipekorea": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/Recipekorea.woff",
  "KR SDKukdetopokki-aLt00": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/SDKukdetopokki-aLt00.woff",
  "KR YUN-BONG-GIL": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.4/YUN-BONG-GIL.woff",
  "KR LeeHyunJi": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/LeeHyunJi.woff",
  "KR NapjakBlock": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/NapjakBlock.woff",
  "KR Swagger": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/Swagger.woff",
  "KR YanoljaYacheR": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/YanoljaYacheR.woff",
  "KR TmonMonsori": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/TmonMonsori.woff",
  "KR YiSunShinRegular": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/YiSunShinRegular.woff",
  "KR YunTaemin": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/YunTaemin.woff",
  "KR ThecircleM": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_two@1.0/ThecircleM.woff",
  "KR designhouseOTFLight00": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_three@1.6/designhouseOTFLight00.woff",
  "KR drfont_daraehand": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_three@1.6/drfont_daraehand.woff",
  "KR SangSangFlowerRoad": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_three@1.6/SangSangFlowerRoad.woff",
  "KR snByulByul": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_three@1.6/snByulByul.woff",
  "KR Bazzi": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/Bazzi.woff",
  "KR ghanachoco": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/ghanachoco.woff",
  "KR KyoboHand": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/KyoboHand.woff",
  "KR MaplestoryOTFBold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/MaplestoryOTFBold.woff",
  "KR NEXON Lv1 Gothic OTF Bold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/NEXON%20Lv1%20Gothic%20OTF%20Bold.woff",
  "KR NEXONFootballGothicBA1": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/NEXONFootballGothicBA1.woff",
  "KR DWImpactamin": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/DWImpactamin.woff",
  "KR ImcreSoojin": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/ImcreSoojin.woff",
  "KR GimpoTitle00": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-04@2.3/GimpoTitle00.woff",
  "KR ROKABold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2104@1.1/ROKABold.woff",
  "KR UhBeeZZIBA-Regular": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2104@1.1/UhBeeZZIBA-Regular.woff",
  "KR Dolbomche_R": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2104@1.1/Dolbomche_R.woff",
  "KR SBAggroB": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.2/SBAggroB.woff",
  "KR HSSaemaul-Regular": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.2/HSSaemaul-Regular.woff",
  "KR CWDangamAsac-Bold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.2/CWDangamAsac-Bold.woff",
  "KR Binggrae-Bold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2110@1.0/Binggrae-Bold.woff2",
  "KR YES24": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2110@1.0/YES24.woff2",
  "KR KOTRAHOPE": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2110@1.0/KOTRAHOPE.woff2",
  "KR KNPSKkomi-Regular00": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2201-2@1.0/KNPSKkomi-Regular00.woff",
  "KR LeferiPoint-SpecialA": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2201-2@1.0/LeferiPoint-SpecialA.woff",
  "KR GangwonEduPowerExtraBoldA": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2201-2@1.0/GangwonEduPowerExtraBoldA.woff",
  "KR SUIT-Bold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2201-2@1.0/SUIT-Bold.woff",
  "KR OKCHAN": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2206-02@1.0/OKCHAN.woff2",
  "KR cachildrenkkum": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2206-02@1.0/cachildrenkkum.woff2",
  "KR HSJiptokki-Round": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.1/HSJiptokki-Round.woff2",
  "KR KCC-Ganpan": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.1/KCC-Ganpan.woff2",
  "KR KCCChassam": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.1/KCCChassam.woff2",
  "KR LOTTERIACHAB": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.1/LOTTERIACHAB.woff2",
  "KR Dovemayo_wild": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.1/Dovemayo_wild.woff2",
  "KR TAEBAEKmilkyway": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.1/TAEBAEKmilkyway.woff2",
  "KR PartialSansKR-Regular": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-1@1.2/PartialSansKR-Regular.woff2",
  "KR Giants-Inline": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-1@1.2/Giants-Inline.woff2",
  "KR YeongdeokSea": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-1@1.2/YeongdeokSea.woff2",
  "KR pixelroborobo": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2307-1@1.2/pixelroborobo.woff",
  "KR JalnanGothic": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_231029@1.1/JalnanGothic.woff",
  "KR Cafe24Moyamoya-Regular-v1.0": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_231029@1.1/Cafe24Moyamoya-Regular-v1.0.woff2",
  "KR ShinDongYupHandwriting-R": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_231029@1.1/ShinDongYupHandwriting-R.woff2",
  "KR Paperlogy-4Regular": "https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/Paperlogy-4Regular.woff2",
  "KR CHOGOONCHICKENSCRATCHV5": "https://cdn.jsdelivr.net/gh/projectnoonnu/2408-3@1.0/CHOGOONCHICKENSCRATCHV5.woff2",
  "KR Ownglyph_jooreeletter-Rg": "https://cdn.jsdelivr.net/gh/projectnoonnu/2405-2@1.0/Ownglyph_jooreeletter-Rg.woff2",
  "KR LINESeedKR-Rg": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_11-01@1.1/LINESeedKR-Rg.woff2",
  "KR Ansungtangmyun-Bold": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_11-01@1.1/Ansungtangmyun-Bold.woff2",
  "KR insungitCutelivelyjisu": "https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_11-01@1.1/insungitCutelivelyjisu.woff2",
};
/** 用樣式表載入的字體（中文網字計劃：一個字體拆成很多小份，照用到的字下載） */
const EXTRA_FONT_CSS: Record<string, string> = {
  "bailubangbangshouxieti": "https://cdn.jsdelivr.net/npm/@chinese-fonts/blbbsxt@2.0.0/dist/%E7%99%BD%E8%B7%AF%E6%A3%92%E6%A3%92%E6%89%8B%E5%86%99%E4%BD%93/result.css",
  "BWCKKT": "https://cdn.jsdelivr.net/npm/@chinese-fonts/bwckkt@3.0.0/dist/%E7%99%BD%E6%97%A0%E5%B8%B8%E5%8F%AF%E5%8F%AF%E4%BD%93-Regular/result.css",
  "LogoSC LongZhuTi": "https://cdn.jsdelivr.net/npm/@chinese-fonts/bxzlzt@3.0.0/dist/%E6%A0%87%E5%B0%8F%E6%99%BA%E9%BE%99%E7%8F%A0%E4%BD%93/result.css",
  "CEF Fonts CJK": "https://cdn.jsdelivr.net/npm/@chinese-fonts/cef@3.0.0/dist/CEFFontsCJK-Regular/result.css",
  "TsangerZhoukeZhengdabangshu": "https://cdn.jsdelivr.net/npm/@chinese-fonts/cezkzdbs@3.0.0/dist/%E4%BB%93%E8%80%B3%E5%91%A8%E7%8F%82%E6%AD%A3%E5%A4%A7%E6%A6%9C%E4%B9%A6/result.css",
  "YunFengchongqingbangbangti": "https://cdn.jsdelivr.net/npm/@chinese-fonts/cqscbbt@2.0.0/dist/YunFengZiKuZhongQingShanChengBangBangTi-2/result.css",
  "chengrongguangke": "https://cdn.jsdelivr.net/npm/@chinese-fonts/crgkk@2.0.0/dist/%E7%A8%8B%E8%8D%A3%E5%85%89%E5%88%BB%E6%A5%B7/result.css",
  "Smiley Sans Oblique": "https://cdn.jsdelivr.net/npm/@chinese-fonts/dyh@3.0.0/dist/SmileySans-Oblique/result.css",
  "Douyin Sans": "https://cdn.jsdelivr.net/npm/@chinese-fonts/dymh@3.0.0/dist/DouyinSansBold/result.css",
  "DOUYU Font": "https://cdn.jsdelivr.net/npm/@chinese-fonts/dyzgt@3.0.0/dist/%E6%96%97%E9%B1%BC%E8%BF%BD%E5%85%89%E4%BD%93/result.css",
  "FlyFlowerSong": "https://cdn.jsdelivr.net/npm/@chinese-fonts/fhst@3.0.0/dist/%E9%A3%9E%E8%8A%B1%E5%AE%8B%E4%BD%93/result.css",
  "GuanKiapTsingKhai-T": "https://cdn.jsdelivr.net/npm/@chinese-fonts/guan-kiap-tsing-khai@2.0.0/dist/GuanKiapTsingKhai-T/result.css",
  "GuanKiapTsingKhai-TW": "https://cdn.jsdelivr.net/npm/@chinese-fonts/guan-kiap-tsing-khai@2.0.0/dist/GuanKiapTsingKhai-TW/result.css",
  "GuanKiapTsingKhai": "https://cdn.jsdelivr.net/npm/@chinese-fonts/guan-kiap-tsing-khai@2.0.0/dist/GuanKiapTsingKhai/result.css",
  "寒蝉全圆体": "https://cdn.jsdelivr.net/npm/@chinese-fonts/hcqyt@2.0.0/dist/ChillRoundFRegular/result.css",
  "QIJIFALLBACK": "https://cdn.jsdelivr.net/npm/@chinese-fonts/hldqjt@3.0.0/dist/qiji-fallback/result.css",
  "hongleixingshu": "https://cdn.jsdelivr.net/npm/@chinese-fonts/hlxsjt@3.0.0/dist/%E9%B8%BF%E9%9B%B7%E8%A1%8C%E4%B9%A6%E7%AE%80%E4%BD%93/result.css",
  "Huiwen-mincho": "https://cdn.jsdelivr.net/npm/@chinese-fonts/hwmct@3.0.0/dist/%E6%B1%87%E6%96%87%E6%98%8E%E6%9C%9D%E4%BD%93/result.css",
  "huangyinqi zhaopai": "https://cdn.jsdelivr.net/npm/@chinese-fonts/hyqzp@3.0.0/dist/%E9%BB%84%E5%BC%95%E9%BD%90%E6%8B%9B%E7%89%8C%E4%BD%93/result.css",
  "荆南俊俊体": "https://cdn.jsdelivr.net/npm/@chinese-fonts/jnjj@3.0.0/dist/JUNJUN/result.css",
  "jiangxizhuokai": "https://cdn.jsdelivr.net/npm/@chinese-fonts/jxzk@3.0.0/dist/%E6%B1%9F%E8%A5%BF%E6%8B%99%E6%A5%B7/result.css",
  "极影毁片文宋 Medium": "https://cdn.jsdelivr.net/npm/@chinese-fonts/jyhpws@2.0.0/dist/%E6%9E%81%E5%BD%B1%E6%AF%81%E7%89%87%E6%96%87%E5%AE%8B/result.css",
  "快看世界体": "https://cdn.jsdelivr.net/npm/@chinese-fonts/kksjt@3.0.0/dist/kuaikanshijieti20231213/result.css",
  "LXGW Neo ZhiSong": "https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgw-neo-zhi-song@2.0.0/dist/LXGWNeoZhiSong/result.css",
  "LXGW Bright": "https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwwenkaibright@2.0.0/dist/LXGWBright-Regular/result.css",
  "Maple Mono CN": "https://cdn.jsdelivr.net/npm/@chinese-fonts/maple-mono-cn@2.0.0/dist/MapleMono-CN-Regular/result.css",
  "MaokenAssortedSans": "https://cdn.jsdelivr.net/npm/@chinese-fonts/mksjh@3.0.0/dist/MaokenAssortedSans/result.css",
  "MaoKenTangYuan (beta)": "https://cdn.jsdelivr.net/npm/@chinese-fonts/mkwtyt@3.0.0/dist/MaoKenTangYuan/result.css",
  "MaokenZhuyuanTi": "https://cdn.jsdelivr.net/npm/@chinese-fonts/mkzyt@3.0.0/dist/%E7%8C%AB%E5%95%83%E7%8F%A0%E5%9C%86%E4%BD%93/result.css",
  "Moon Stars Kai": "https://cdn.jsdelivr.net/npm/@chinese-fonts/moon-stars-kai@2.0.0/dist/MoonStarsKai-Regular/result.css",
  "Moon Stars Kai T": "https://cdn.jsdelivr.net/npm/@chinese-fonts/moon-stars-kai@2.0.0/dist/MoonStarsKaiT-Regular/result.css",
  "MuzaiPixel": "https://cdn.jsdelivr.net/npm/@chinese-fonts/mzxst@3.0.0/dist/MZPXflat/result.css",
  "PING FANG GONG ZI TI": "https://cdn.jsdelivr.net/npm/@chinese-fonts/pfgzt@3.0.0/dist/%E5%B9%B3%E6%96%B9%E5%85%AC%E5%AD%90%E4%BD%93/result.css",
  "平方赖江湖飞扬体": "https://cdn.jsdelivr.net/npm/@chinese-fonts/pfljhfyt@3.0.0/dist/PingFangLaiJiangHuFeiYangTi-2/result.css",
  "平方赖江湖琅琊体": "https://cdn.jsdelivr.net/npm/@chinese-fonts/pfljhlyt@3.0.0/dist/%E5%B9%B3%E6%96%B9%E8%B5%96%E6%B1%9F%E6%B9%96%E7%90%85%E7%90%8A%E4%BD%93/result.css",
  "PING FANG MENG MNEG DA": "https://cdn.jsdelivr.net/npm/@chinese-fonts/pfmmd@3.0.0/dist/%E5%B9%B3%E6%96%B9%E8%90%8C%E8%90%8C%E5%93%92/result.css",
  "PangMenZhengDao-XiXian": "https://cdn.jsdelivr.net/npm/@chinese-fonts/pmzdxxt@3.0.0/dist/%E5%BA%9E%E9%97%A8%E6%AD%A3%E9%81%93%E7%BB%86%E7%BA%BF%E4%BD%93/result.css",
  "qiantubifengshouxieti": "https://cdn.jsdelivr.net/npm/@chinese-fonts/qtbfsxt@3.0.0/dist/%E5%8D%83%E5%9B%BE%E7%AC%94%E9%94%8B%E6%89%8B%E5%86%99%E4%BD%93/result.css",
  "QuanPixel 8px": "https://cdn.jsdelivr.net/npm/@chinese-fonts/qxs@3.0.0/dist/quan/result.css",
  "瑞美加张清平硬笔行书": "https://cdn.jsdelivr.net/npm/@chinese-fonts/rmjzqpybxs@3.0.0/dist/%E7%91%9E%E7%BE%8E%E5%8A%A0%E5%BC%A0%E6%B8%85%E5%B9%B3%E7%A1%AC%E7%AC%94%E8%A1%8C%E4%B9%A6/result.css",
  "nzgrKangxi": "https://cdn.jsdelivr.net/npm/@chinese-fonts/rzjkxzdmh@3.0.0/dist/nzgrKangxi/result.css",
  "nzgrRuYinZouZhangKai": "https://cdn.jsdelivr.net/npm/@chinese-fonts/rzjryzzk@3.0.0/dist/nzgrRuYinZouZhangKai/result.css",
  "SuCaiJiShi-SheHuiTi": "https://cdn.jsdelivr.net/npm/@chinese-fonts/scjssh@3.0.0/dist/%E7%B4%A0%E6%9D%90%E9%9B%86%E5%B8%82%E7%A4%BE%E4%BC%9A%E4%BD%93/result.css",
  "The Peak Font 隨峰體 Beta": "https://cdn.jsdelivr.net/npm/@chinese-fonts/sft@3.0.0/dist/%E9%9A%8F%E5%B3%B0%E4%BD%93/result.css",
  "STDongGuanTi": "https://cdn.jsdelivr.net/npm/@chinese-fonts/stdgt@2.0.0/dist/%E4%B8%8A%E5%9B%BE%E4%B8%9C%E8%A7%82%E4%BD%93-%E5%B8%B8%E8%A7%84/result.css",
  "shetumodengxiaofangti": "https://cdn.jsdelivr.net/npm/@chinese-fonts/stmdxf@3.0.0/dist/%E6%91%84%E5%9B%BE%E6%91%A9%E7%99%BB%E5%B0%8F%E6%96%B9%E4%BD%93/result.css",
  "YouSheShaYuFeiTeJianKangTi": "https://cdn.jsdelivr.net/npm/@chinese-fonts/syftjkt@3.0.0/dist/%E4%BC%98%E8%AE%BE%E9%B2%A8%E9%B1%BC%E8%8F%B2%E7%89%B9%E5%81%A5%E5%BA%B7%E4%BD%93/result.css",
  "Source Han Serif CN for Display": "https://cdn.jsdelivr.net/npm/@chinese-fonts/sypxzs@3.0.0/dist/%E6%80%9D%E6%BA%90%E5%B1%8F%E6%98%BE%E8%87%BB%E5%AE%8B/result.css",
  "Source Han Serif CN VF": "https://cdn.jsdelivr.net/npm/@chinese-fonts/syst@3.0.0/dist/SourceHanSerifCN/result.css",
  "ToneOZ-Tsuipita-TC": "https://cdn.jsdelivr.net/npm/@chinese-fonts/toneoz-tsuipita@2.0.0/dist/ToneOZ-Tsuipita-TC/result.css",
  "Xiaohe Simplify Sans VF": "https://cdn.jsdelivr.net/npm/@chinese-fonts/xiaohe-simplify@2.0.0/dist/XiaoheSimplifySans-VF/result.css",
  "Xiaohe Simplify Serif VF": "https://cdn.jsdelivr.net/npm/@chinese-fonts/xiaohe-simplify@2.0.0/dist/XiaoheSimplifySerif-VF/result.css",
  "Xiaolai SC": "https://cdn.jsdelivr.net/npm/@chinese-fonts/xiaolai@3.0.0/dist/Xiaolai/result.css",
  "XuandongKaishu": "https://cdn.jsdelivr.net/npm/@chinese-fonts/xuandongkaishu@3.0.0/dist/XuandongKaishu/result.css",
  "YuFanXinYu": "https://cdn.jsdelivr.net/npm/@chinese-fonts/yfxy@3.0.0/dist/YuFanXinYu-Regular/result.css",
  "I.Ngaan": "https://cdn.jsdelivr.net/npm/@chinese-fonts/yidianyan@3.0.0/dist/yidianyan/result.css",
  "Yozai": "https://cdn.jsdelivr.net/npm/@chinese-fonts/yozai@3.0.0/dist/Yozai-Regular/result.css",
  "YouSheBiaoTiHei": "https://cdn.jsdelivr.net/npm/@chinese-fonts/ysbth@3.0.0/dist/%E4%BC%98%E8%AE%BE%E6%A0%87%E9%A2%98%E9%BB%91/result.css",
  "峄山碑篆体": "https://cdn.jsdelivr.net/npm/@chinese-fonts/ysbzt@3.0.0/dist/%E5%B3%84%E5%B1%B1%E7%A2%91%E7%AF%86%E4%BD%93/result.css",
  "Slidefu": "https://cdn.jsdelivr.net/npm/@chinese-fonts/ysfxt@3.0.0/dist/Slidefu-Regular/result.css",
  "YEFONTXiaoShiTou": "https://cdn.jsdelivr.net/npm/@chinese-fonts/yzgcxst@3.0.0/dist/%E4%B9%9F%E5%AD%97%E5%B7%A5%E5%8E%82%E5%B0%8F%E7%9F%B3%E5%A4%B4/result.css",
  "zihunbiantaoti": "https://cdn.jsdelivr.net/npm/@chinese-fonts/zhbtt@3.0.0/dist/%E5%AD%97%E9%AD%82%E6%89%81%E6%A1%83%E4%BD%93/result.css",
  "SoukouMincho": "https://cdn.jsdelivr.net/npm/@chinese-fonts/zjmc@3.0.0/dist/%E8%A3%85%E7%94%B2%E6%98%8E%E6%9C%9D%E4%BD%93/result.css",
  "xiaowei": "https://cdn.jsdelivr.net/npm/@chinese-fonts/zkxw@3.0.0/dist/%E7%AB%99%E9%85%B7%E5%B0%8F%E8%96%87LOGO%E4%BD%93_%E7%8C%AB%E5%95%83%E7%BD%91/result.css",
  "ZoomlaMengyas-A080": "https://cdn.jsdelivr.net/npm/@chinese-fonts/zlmyz@3.0.0/dist/%E9%80%90%E6%B5%AA%E8%90%8C%E8%8A%BD%E5%AD%97/result.css",
  "Zhuque Fangsong (technical preview)": "https://cdn.jsdelivr.net/npm/@chinese-fonts/zqfs@3.0.0/dist/ZhuqueFangsong-Regular/result.css",
  "FontQu Smile 常规": "https://cdn.jsdelivr.net/npm/@chinese-fonts/zzqxmxht@3.0.0/dist/%E5%AD%97%E5%88%B6%E5%8C%BA%E5%96%9C%E8%84%89%E5%96%9C%E6%AC%A2%E4%BD%93/result.css",
  "Hangeuljaemin4.0": "https://cdn.jsdelivr.net/npm/@chinese-fonts/hqzmt@3.0.0/dist/Hangeuljaemin4-Regular/result.css",
};
const SINGLE_WEIGHT_FONTS = new Set(["Aboreto", "Alex Brush", "Allura", "Annie Use Your Telescope", "Aoboshi One", "Architects Daughter", "Bad Script", "Bagel Fat One", "Bangers", "Berkshire Swash", "Black And White Picture", "Black Ops One", "Bowlby One", "Bowlby One SC", "Bpmf Huninn", "Bpmf Iansui", "Bpmf Zihi Kai Std", "Calistoga", "Caprasimo", "Carter One", "Caveat Brush", "Cedarville Cursive", "Changa One", "Chango", "Chelsea Market", "Cherry Bomb One", "Chokokutai", "Coda", "Concert One", "Cookie", "Courgette", "Creepster", "Damion", "Darumadrop One", "Dela Gothic One", "Delius", "Diphylleia", "Forum", "Fugaz One", "Gasoek One", "Gloria Hallelujah", "Gochi Hand", "Grandiflora One", "Gravitas One", "Handlee", "Homemade Apple", "Italianno", "Just Another Hand", "Kaushan Script", "Kiwi Maru", "Knewave", "LXGW Marker Gothic", "Lilita One", "Liu Jian Mao Cao", "Londrina Solid", "Long Cang", "Luckiest Guy", "Ma Shan Zheng", "Marck Script", "Megrim", "Mochiy Pop P One", "Monomaniac One", "Mr Dafoe", "Mrs Saint Delafield", "Ms Madi", "Neucha", "Nothing You Could Do", "Oooh Baby", "Orbit", "Palette Mosaic", "Pangolin", "Parisienne", "Patrick Hand", "Patua One", "Pinyon Script", "Pirata One", "Plaster", "Playball", "Poiret One", "Racing Sans One", "Rammetto One", "Reenie Beanie", "Rock Salt", "Rubik Glitch", "Rubik Pixels", "Rye", "Sacramento", "Shippori Antique B1", "Shizuru", "Slackside One", "Sofia", "Special Elite", "Squada One", "Staatliches", "Unica One", "UnifrakturMaguntia", "UoqMunThenKhung", "WDXL Lubrifont JP N", "WDXL Lubrifont SC", "WDXL Lubrifont TC", "Yellowtail", "Yeseva One", "Yomogi", "Yuji Hentaigana Akari", "Yuji Hentaigana Akebono", "Yuji Mai", "ZCOOL KuaiLe", "ZCOOL QingKe HuangYou", "ZCOOL XiaoWei", "Zen Kurenaido", "Zeyada", "Zhi Mang Xing"]);

const storeFailed = new Set<string>();
/** 這個字體從哪裡下載（整個字體檔，給「下載到本機」用） */
export function fontSource(family: string): FontSource {
  if (EXTRA_FONT_URLS[family]) return { url: EXTRA_FONT_URLS[family] };
  if (EXTRA_FONT_CSS[family]) return { css: EXTRA_FONT_CSS[family] };
  return { google: 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+')
    + (SINGLE_WEIGHT_FONTS.has(family) ? ':wght@400&display=swap' : ':wght@400;700&display=swap') };
}
/** 把整個字體下載到本機（之後打開 App 不用再等）。下載完就能用。 */
export async function downloadFontFully(family: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  if (family === SYMBOL_FONT) return true;
  /* quiet：只存到本機、不在這次重新登記（字體已經在用了；重新登記一百多份會讓畫面一直以為字型換了而重畫） */
  const ok = await downloadFont(family, fontSource(family), { register: !opts.quiet });
  if (ok && opts.quiet) return true;
  if (ok) { cssDone.add(family); requested.set(family, Promise.resolve()); window.dispatchEvent(new Event('abai-font-ready')); }
  return ok;
}

/**
 * 需要時才把某個字體的 <link> 塞進 head。重複呼叫不會重複載入。
 * 回傳的 Promise 在那份 CSS 真的下載完（或失敗）之後才 resolve ——
 * CSS 還沒到的時候 @font-face 根本還不存在，這時候去問 document.fonts.check
 * 會拿到「可以」的假答案（其實是配到系統的退回字體）。
 */
export function ensureFont(family: string): Promise<void> {
  if (family === SYMBOL_FONT) { cssDone.add(family); return Promise.resolve(); }
  if (typeof document === 'undefined') return Promise.resolve();
  /* Noto Sans TC 已由 index.html 在開場畫面期間載完。App 解鎖之後直接認領
     那份字身，避免第一次新增文字又插入同一張 Google Fonts 樣式表，導致
     量測延後一格、文字和選中框看起來抖一下。 */
  if (family === DEFAULT_FONT
      && document.documentElement.classList.contains('fonts-loaded')
      && document.fonts?.check(`400 40px "${family}"`)) {
    cssDone.add(family);
    return Promise.resolve();
  }
  const hit = requested.get(family);
  if (hit) return hit;
  /* 已經下載到本機的字體：直接從本機登記，不用網路、不用等（見 utils/fontStore） */
  if (isFontDownloaded(family) && !storeFailed.has(family)) {
    const p = loadStoredFont(family).then(ok => {
      if (ok) { cssDone.add(family); window.dispatchEvent(new Event('abai-font-ready')); return; }
      storeFailed.add(family); requested.delete(family); return ensureFont(family);
    });
    requested.set(family, p);
    return p;
  }
  if (EXTRA_FONT_URLS[family]) {
    const p = new FontFace(family, `url("${EXTRA_FONT_URLS[family]}")`).load().then(face => {
      document.fonts.add(face); cssDone.add(family);
    }).catch(() => { requested.delete(family); });
    requested.set(family, p);
    return p;
  }
  if (EXTRA_FONT_CSS[family]) {
    const p = new Promise<void>(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = EXTRA_FONT_CSS[family];
      const done = () => { cssDone.add(family); resolve(); };
      link.onload = done; link.onerror = () => { requested.delete(family); resolve(); };
      document.head.appendChild(link);
    });
    requested.set(family, p);
    return p;
  }
  if (registerFamily(family)) { cssDone.add(family); const ok = Promise.resolve(); requested.set(family, ok); return ok; }
  const p = new Promise<void>(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') +
      (SINGLE_WEIGHT_FONTS.has(family) ? ':wght@400&display=swap' : ':wght@400;700&display=swap');
    const done = () => { cssDone.add(family); resolve(); };
    link.onload = done;
    link.onerror = done;
    document.head.appendChild(link);
  });
  requested.set(family, p);
  return p;
}

/** 這個家族的 CSS 下載完了沒（同步版）。 */
export function fontCssLoaded(family: string) {
  return cssDone.has(family);
}

/** 家族名 → 有沒有真正的斜體字身。沒有這個 key 代表還沒問過。 */
const italicSupport = new Map<string, boolean>();
const italicPending = new Map<string, Promise<boolean>>();

/**
 * 載入某個字體的斜體字身，順便問出「這個家族到底有沒有斜體」。
 *
 * Google Fonts 對沒有斜體的家族會直接回 400，所以用 <link> 的 load / error
 * 就能得到答案。斜體刻意用「另一個」<link>：就算失敗也只是這一份沒載到，
 * 正體那一份不受影響。沒有斜體字身時瀏覽器會自己歪一個假斜體出來，那不是
 * 真的斜體，所以問不到的家族就不該給使用者這個選項。
 */
export function ensureItalic(family: string): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  // 不是 Google Fonts 的字體（單一字體檔／中文網字計劃）沒有另外的斜體字身
  if (EXTRA_FONT_URLS[family] || EXTRA_FONT_CSS[family]) { italicSupport.set(family, false); return Promise.resolve(false); }
  const known = italicSupport.get(family);
  if (known !== undefined) return Promise.resolve(known);
  const pending = italicPending.get(family);
  if (pending) return pending;
  const p = new Promise<boolean>(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') +
      ':ital,wght@1,400;1,700&display=swap';
    link.onload = () => {
      italicSupport.set(family, true);
      resolve(true);
      /* 順手把斜體字身「真的下載下來」。只插 <link> 的話 @font-face 只是宣告，
         woff2 要等第一次用到才下載 —— 使用者按下斜體那一刻瀏覽器手上沒有斜體
         字身，會先自己把正體歪一個假斜體頂著，字身到了再換掉，那個換掉就是
         看到的抖一下。先在背景載好，按下去就是直接換成真的斜體。 */
      if (document.fonts) {
        document.fonts.load(`italic 400 40px "${family}"`).catch(() => {});
        document.fonts.load(`italic 700 40px "${family}"`).catch(() => {});
      }
    };
    link.onerror = () => { italicSupport.set(family, false); link.remove(); resolve(false); };
    document.head.appendChild(link);
  });
  italicPending.set(family, p);
  return p;
}

/** 已經問到的答案；還沒問過回 undefined（給 UI 判斷要不要先藏起來）。 */
export function knownItalic(family: string) {
  return italicSupport.get(family);
}

/** 匯出前要確定字體真的下載完了，否則 canvas 會用退回字體畫出去。 */
export async function waitForFont(family: string, weight = 400, italic = false) {
  await ensureFont(family);
  if (italic) await ensureItalic(family);
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 64px "${family}"`);
    await document.fonts.ready;
  } catch {
    /* 載不到就讓瀏覽器自己退回預設字體 */
  }
}

const sampleLoads = new Map<string, Promise<void>>();
export function prepareFontSample(font: FontDef): Promise<void> {
  const cached = sampleLoads.get(font.name);
  if (cached) return cached;
  const pending = ensureFont(font.name).then(async () => {
    await document.fonts.load(`400 40px "${font.name}"`, FONT_SAMPLE[font.category]);
  }).catch(() => { sampleLoads.delete(font.name); });
  sampleLoads.set(font.name, pending);
  return pending;
}

let warmingSamples = false;
/* 字體宣告先抓好、拆好，用到才登記。
   以前是每個字體插一張 Google Fonts 的 <link>：每插一張、它載完時，瀏覽器都要把整頁的樣式重算一次
   （手機上每次幾十毫秒），一百多個字體各插一張，開 App 之後很長一段時間按任何按鈕都可能剛好撞上。
   一次把一萬多條 @font-face 全部登記也一樣卡。所以：
     ‧ warmFontCss：分幾批把 CSS 抓下來（純網路），拆成「家族 → 那個家族的 @font-face」，不登記；
     ‧ ensureFont：真的要用某個字體時，才用 FontFace API 登記那一個家族（一兩百條，幾毫秒）。
   登記不會讓整頁重算樣式，也不會讓開場等的 document.fonts.ready 等它。抓不到就照舊插 <link>。 */
const faceRules = new Map<string, { src: string; desc: FontFaceDescriptors }[]>();
const batchFetches: Promise<void>[] = [];
function fetchFontBatch(families: string[]) {
  const todo = families.filter(f => !requested.has(f) && !EXTRA_FONT_URLS[f] && !EXTRA_FONT_CSS[f] && !faceRules.has(f));
  if (!todo.length || typeof FontFace === 'undefined') return;
  const url = 'https://fonts.googleapis.com/css2?' + todo.map(f =>
    'family=' + encodeURIComponent(f).replace(/%20/g, '+') + (SINGLE_WEIGHT_FONTS.has(f) ? ':wght@400' : ':wght@400;700')).join('&') + '&display=swap';
  batchFetches.push((async () => {
    try {
      const r = await fetch(url); if (!r.ok) return;
      const css = await r.text();
      const pick = (body: string, k: string) => { const m = body.match(new RegExp(k + '\\s*:\\s*([^;]+);')); return m ? m[1].trim() : ''; };
      for (const rule of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
        const fam = pick(rule, 'font-family').replace(/^['"]|['"]$/g, ''), src = pick(rule, 'src');
        if (!fam || !src) continue;
        const desc: FontFaceDescriptors = { style: pick(rule, 'font-style') || 'normal', weight: pick(rule, 'font-weight') || '400', display: 'swap' };
        const ur = pick(rule, 'unicode-range'); if (ur) desc.unicodeRange = ur;
        let list = faceRules.get(fam); if (!list) faceRules.set(fam, list = []);
        list.push({ src, desc });
      }
    } catch { /* 抓不到就讓 ensureFont 照舊插 <link> */ }
  })());
}
/** 已經拆好宣告的家族：登記進 document.fonts。成功回 true */
function registerFamily(family: string): boolean {
  const list = faceRules.get(family);
  if (!list || !list.length) return false;
  try { for (const r of list) document.fonts.add(new FontFace(family, r.src, r.desc)); } catch { return false; }
  faceRules.delete(family);
  return true;
}
/** 全部字體的樣式表併成幾張，在開場畫面那 3 秒（反正沒人能操作）就載完、重算完。
    開場收起之後首頁就不會再因為樣式表進來而整頁重算、按下去頓一下。
    只是樣式表（@font-face 宣告），字身檔要等用到或 warmFontSamples 才下載，不影響開機等的那一個字體。 */
export function warmFontCss() {
  if (typeof document === 'undefined') return;
  // Google Fonts 的網址太長（約 4KB）會整張被拒，所以分幾張同時送出（每張 45 個家族，約 1.5KB）
  const names = FONTS.map(f => f.name);
  for (let i = 0; i < names.length; i += 45) fetchFontBatch(names.slice(i, i + 45));
}
/** App 掛載時就開始，不是等打開字型選單；樣式表分幾批、在空檔插，字身限制同時下載的數量 */
export function warmFontSamples() {
  if (warmingSamples || typeof document === 'undefined') return;
  warmingSamples = true;
  void (async () => {
    warmFontCss();
    await Promise.all(batchFetches);
    /* 有預先畫好預覽圖的字體（字體選單直接顯示圖，見 FontCard）不必一開 App 就下載範例字 ——
       四百多個字體全部下載會拖慢整個 App。先把那幾張預覽圖抓下來，選單一打開就是完整的。 */
    if (typeof Image !== 'undefined') for (const c of Object.keys(FONT_PREVIEW_INDEX)) { const im = new Image(); im.src = `${import.meta.env.BASE_URL}font-previews/${c}.png`; }
    const queue = FONTS.filter(f => !FONT_PREVIEW_INDEX[f.category]?.includes(f.name));
    const worker = async () => {
      while (queue.length) await prepareFontSample(queue.shift()!);
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  })();
}

/** 也預熱文件裡實際用到的字；中日韓字型是用 unicode-range 分段的 */
export function warmTextFonts(text: string) {
  const queue = [...FONTS];
  let cancelled = false;
  const worker = async () => {
    while (queue.length && !cancelled) {
      const font = queue.shift()!;
      await prepareFontSample(font);
      if (cancelled) return;
      await document.fonts.load(`400 40px "${font.name}"`, text || FONT_SAMPLE[font.category]).catch(() => {});
    }
  };
  void Promise.all(Array.from({ length: 3 }, worker));
  return () => { cancelled = true; };
}

/** 預覽與匯出要用同一組 font shorthand，文字才會落在同一個位置。 */
export function fontStack(family?: string) {
  return `"${family || DEFAULT_FONT}", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
}

/* 畫布上的字體：文字平常是 DOM 顯示，播動畫、匯出時改畫在畫布上。畫布要的那個字重／斜體如果還沒下載，
   瀏覽器會默默用系統字體頂替，而且「只畫在畫布上」不一定會觸發下載 —— 那就是動畫時字體偶爾自己變掉。
   每次設定畫布字體時呼叫：還沒好的就主動下載，好了發 abai-font-ready 讓畫面重畫一次。 */
const canvasFontAsked = new Set<string>();
export function primeCanvasFont(font: string) {
  if (typeof document === 'undefined' || !document.fonts || canvasFontAsked.has(font)) return;
  try { if (document.fonts.check(font)) { canvasFontAsked.add(font); return; } } catch { return; }
  canvasFontAsked.add(font);
  document.fonts.load(font).then(() => { window.dispatchEvent(new Event('abai-font-ready')); }, () => { canvasFontAsked.delete(font); });
}

/* 任何字型（或中文字型的某一小份）下載完成：通知畫面重畫，並讓「畫好存起來」的文字貼圖作廢重做。
   不這樣的話，字型還沒到之前用備用字體畫的那一張會一直被沿用（動畫中看起來就是字體自己變了）。 */
export let fontEpoch = 0;
if (typeof document !== 'undefined' && (document as any).fonts?.addEventListener) {
  (document as any).fonts.addEventListener('loadingdone', () => {
    fontEpoch++;
    window.dispatchEvent(new Event('abai-font-ready'));
  });
}

/* 確保畫面上的文字真的用它自己的字體畫：註冊字體家族、把這段字實際用到的字（中文字型是分包下載的）載好。
   打開草稿、新增文字、改字、搬動時都會呼叫；已經好的會直接略過。全部到齊時發 abai-font-ready 讓畫面重畫。 */
const glyphsDone = new Set<string>();
export function ensureTextFonts(items: { family: string; text: string; bold?: boolean; italic?: boolean }[]) {
  if (typeof document === 'undefined') return;
  for (const it of items) {
    if (!it.text) continue;
    const key = `${it.family}|${it.bold ? 1 : 0}|${it.italic ? 1 : 0}|${it.text}`;
    if (glyphsDone.has(key)) continue;
    glyphsDone.add(key);
    const css = `${it.italic ? 'italic ' : ''}${it.bold ? 700 : 400} 40px "${it.family}"`;
    void ensureFont(it.family)
      .then(() => (document as any).fonts?.load?.(css, it.text))
      .then(() => { fontEpoch++; window.dispatchEvent(new Event('abai-font-ready')); })
      .catch(() => { glyphsDone.delete(key); });
  }
}
