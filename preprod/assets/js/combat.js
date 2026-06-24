(function (root) {
  "use strict";
  // ===== Combat PokéKanto : couche données ROM + sprites (le moteur logique = Showdown) =====
  var O_BASESTATS=0x24ebd4, O_MOVES=0x24b054, O_TYPEEFF=0x24945c, O_SPNAMES=0x2402ec, O_MVNAMES=0x2414a0;
  var O_FRONT=0x22f4b8, O_BACK=0x2301e0, O_PAL=0x231718;
  var PARTY=0x24284, COUNT=0x24029, TAILLE=100;
  var ORD=["GAEM","GAME","GEAM","GEMA","GMAE","GMEA","AGEM","AGME","AEGM","AEMG","AMGE","AMEG","EGAM","EGMA","EAGM","EAMG","EMGA","EMAG","MGAE","MGEA","MAGE","MAEG","MEGA","MEAG"];
  var TYPES_FR=["Normal","Combat","Vol","Poison","Sol","Roche","Insecte","Spectre","Acier","???","Feu","Eau","Plante","Électrik","Psy","Glace","Dragon","Ténèbres"];
  var NATURES=["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax","Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash","Calm","Gentle","Sassy","Careful","Quirky"];

  function ewram(){ try{ var m=root.IodineGUI&&root.IodineGUI.Iodine.IOCore.memory; return m?m.externalRAM:null; }catch(e){ return null; } }
  function rom(){ try{ return root.IodineGUI.Iodine.IOCore.cartridge.ROM; }catch(e){ return null; } }
  function ru32(R,o){ return (R[o]|(R[o+1]<<8)|(R[o+2]<<16)|(R[o+3]<<24))>>>0; }

  // charset Gen3
  var CH={}; (function(){ CH[0]=" ";CH[0xAB]="!";CH[0xAC]="?";CH[0xAD]=".";CH[0xAE]="-";CH[0xB4]="'";
    for(var i=0;i<10;i++)CH[0xA1+i]=String.fromCharCode(48+i);
    for(i=0;i<26;i++)CH[0xBB+i]=String.fromCharCode(65+i);
    for(i=0;i<26;i++)CH[0xD5+i]=String.fromCharCode(97+i);
    CH[0x06]="É";CH[0x1B]="é";CH[0x1A]="è";CH[0x16]="à";CH[0x19]="ç";CH[0x1C]="ê";CH[0x20]="î";CH[0x24]="ô";CH[0x26]="ù";CH[0x28]="û"; })();
  function dName(R,off,len){ var s=""; for(var i=0;i<len;i++){ var b=R[off+i]; if(b===0xFF)break; s+=(CH[b]!=null?CH[b]:""); } return s; }
  function speciesName(sp){ var R=rom(); return R?dName(R,O_SPNAMES+sp*11,11):("#"+sp); }
  function moveName(id){ var R=rom(); return R?dName(R,O_MVNAMES+id*13,13):("#"+id); }

  function moveData(id){ var R=rom(); if(!R||id<=0) return null; var o=O_MOVES+id*12,pr=R[o+7]; if(pr>127)pr-=256; return {id:id,nom:moveName(id),effect:R[o],power:R[o+1],type:R[o+2],acc:R[o+3],ppMax:R[o+4],priority:pr}; }
  function speciesTypes(sp){ var R=rom(); if(!R) return [0]; var o=O_BASESTATS+sp*28,a=R[o+6],b=R[o+7]; return a===b?[a]:[a,b]; }
  var _chart=null;
  function typeChart(){ if(_chart) return _chart; var R=rom(); if(!R) return {}; var c={},o=O_TYPEEFF,g=0; while(g++<4000){ var a=R[o]; if(a===0xFF)break; if(a===0xFE){o+=3;continue;} (c[a]=c[a]||{})[R[o+1]]=R[o+2]/10; o+=3; } _chart=c; return c; }
  function natdex(idx){ return idx<=251?idx:(idx>=277&&idx<=411?idx-25:0); }  // Kanto/Johto idx==natdex ; Hoenn interne 277-411 -> national 252-386

  // ----- sprites (LZ77 -> dataURL) -----
  function lz77(R,off){ var size=R[off+1]|(R[off+2]<<8)|(R[off+3]<<16),out=new Uint8Array(size),src=off+4,dst=0; while(dst<size){ var fl=R[src++]; for(var b=0;b<8&&dst<size;b++){ if(fl&0x80){ var b1=R[src++],b2=R[src++],len=(b1>>4)+3,disp=(((b1&0xF)<<8)|b2)+1; for(var i=0;i<len&&dst<size;i++){out[dst]=out[dst-disp];dst++;} } else { out[dst++]=R[src++]; } fl=(fl<<1)&0xFF; } } return out; }
  var _spCache={};
  function spriteDataURL(species, back){
    var k=(back?"b":"f")+species; if(_spCache[k]!==undefined) return _spCache[k];
    var R=rom(); if(!R){ return null; }
    try{
      var tbl=back?O_BACK:O_FRONT;
      var pix=lz77(R, ru32(R,tbl+species*8)-0x08000000);
      var palRaw=lz77(R, ru32(R,O_PAL+species*8)-0x08000000);
      var cols=[]; for(var i=0;i<16;i++){ var v=palRaw[i*2]|(palRaw[i*2+1]<<8); cols.push([(v&0x1F)*8,((v>>5)&0x1F)*8,((v>>10)&0x1F)*8]); }
      var cv=document.createElement("canvas"); cv.width=64; cv.height=64; var ctx=cv.getContext("2d"), im=ctx.createImageData(64,64), d=im.data;
      for(var t=0;t<64;t++){ var tx=(t%8)*8, ty=((t/8)|0)*8; for(var by=0;by<8;by++)for(var bx=0;bx<4;bx++){ var byte=pix[t*32+by*4+bx], lo=byte&0xF, hi=(byte>>4)&0xF; var p0=((ty+by)*64+(tx+bx*2))*4, p1=((ty+by)*64+(tx+bx*2+1))*4, c0=cols[lo], c1=cols[hi]; d[p0]=c0[0];d[p0+1]=c0[1];d[p0+2]=c0[2];d[p0+3]=lo===0?0:255; d[p1]=c1[0];d[p1+1]=c1[1];d[p1+2]=c1[2];d[p1+3]=hi===0?0:255; } }
      ctx.putImageData(im,0,0); var url=cv.toDataURL(); _spCache[k]=url; return url;
    }catch(e){ _spCache[k]=null; return null; }
  }

  // ----- décodage équipe (complet, pour Showdown) -----
  function r16(ew,o){ return ew[o]|(ew[o+1]<<8); }
  function r32(ew,o){ return (ew[o]|(ew[o+1]<<8)|(ew[o+2]<<16)|(ew[o+3]<<24))>>>0; }
  function decodeBattleMon(ew, off){
    var p=r32(ew,off), otid=r32(ew,off+4); if(p===0) return null;
    var key=(p^otid)>>>0, or=ORD[p%24];
    function sub(L){ return off+0x20+or.indexOf(L)*12; } function dw(a){ return (r32(ew,a)^key)>>>0; }
    var g=sub("G"),a=sub("A"),e=sub("E"),m=sub("M");
    var species=dw(g)&0xFFFF, item=(dw(g)>>>16)&0xFFFF;
    var w0=dw(a),w1=dw(a+4); var moves=[w0&0xFFFF,(w0>>>16)&0xFFFF,w1&0xFFFF,(w1>>>16)&0xFFFF].filter(function(x){return x>0;});
    var e0=dw(e),e1=dw(e+4); var ev=[e0&0xFF,(e0>>>8)&0xFF,(e0>>>16)&0xFF,(e0>>>24)&0xFF,e1&0xFF,(e1>>>8)&0xFF];
    var ivw=dw(m+4); var iv=[ivw&0x1F,(ivw>>>5)&0x1F,(ivw>>>10)&0x1F,(ivw>>>15)&0x1F,(ivw>>>20)&0x1F,(ivw>>>25)&0x1F], abilSlot=(ivw>>>31)&1;
    return { species:species, nomFr:speciesName(species), niveau:ew[off+0x54], item:item, moves:moves, ev:ev, iv:iv,
             nature:NATURES[p%25], natureIdx:p%25, abilSlot:abilSlot, types:speciesTypes(species),
             statsJeu:{ maxhp:r16(ew,off+0x58), atk:r16(ew,off+0x5A), def:r16(ew,off+0x5C), spe:r16(ew,off+0x5E), spa:r16(ew,off+0x60), spd:r16(ew,off+0x62) } };
  }
  function decodeBattleTeam(){ var ew=ewram(); if(!ew) return null; var c=ew[COUNT]; if(c<0||c>6) return []; var t=[]; for(var i=0;i<c;i++){ var mn=decodeBattleMon(ew,PARTY+i*TAILLE); if(mn) t.push(mn); } return t; }

  var api={ moveData:moveData, speciesTypes:speciesTypes, typeChart:typeChart, speciesName:speciesName, moveName:moveName,
            spriteDataURL:spriteDataURL, decodeBattleTeam:decodeBattleTeam, decodeBattleMon:decodeBattleMon, natdex:natdex,
            TYPES_FR:TYPES_FR, NATURES:NATURES };
  if(typeof window!=="undefined") (window.Valdoria=window.Valdoria||{}).combat=api;
  if(typeof module!=="undefined") module.exports=api;
})(typeof window!=="undefined"?window:this);
