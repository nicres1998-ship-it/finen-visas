(()=>{'use strict';const root=document.getElementById('finenCollage');if(!root)return;root.replaceChildren();const photos=[
['https://commons.wikimedia.org/wiki/Special:FilePath/Portada_pasaporte_mexicano.jpg','Pasaporte mexicano auténtico'],
['https://commons.wikimedia.org/wiki/Special:FilePath/Filtros_Migratorios_Aut%C3%B3nomos_en_Aeropuerto_Internacional_de_la_Ciudad_de_M%C3%A9xico.jpg','Control migratorio en aeropuerto de México'],
['https://commons.wikimedia.org/wiki/Special:FilePath/Mexico_issued_passport_visa_pages.jpg','Páginas de pasaporte emitido en México'],
['https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=800&q=85','Viaje internacional en avión'],
['https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800&q=85','Orientación profesional'],
['https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&q=85','Preparativos de viaje'],
['https://commons.wikimedia.org/wiki/Special:FilePath/Portada_Pasaporte_Mexicano.png','Documento de viaje mexicano'],
['https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&q=85','Estudios internacionales'],
['https://images.unsplash.com/photo-1543269865-cbf427effbad?w=800&q=85','Personas en capacitación'],
['https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800&q=85','Entrevista profesional'],
['https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=85','Experiencia de viaje'],
['https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=85','Orientación y formación']];
const spots=[[-9,-6,39,40,-11,3],[28,-7,43,42,8,5],[68,-5,38,43,11,4],[-8,27,40,44,8,7],[25,25,45,49,-9,10],[65,28,43,45,-12,8],[-7,66,40,43,-8,11],[30,65,44,44,9,13],[67,65,40,43,8,12]];let cursor=0;const used=[];const tiles=spots.map((s)=>{const d=document.createElement('div');d.className='finen-tile';d.style.cssText='--x:'+s[0]+'%;--y:'+s[1]+'%;--w:'+s[2]+'%;--h:'+s[3]+'%;--rot:'+s[4]+'deg;--layer:'+s[5];const img=document.createElement('img');img.loading='eager';img.decoding='async';d.append(img);root.append(d);used.push(-1);return img});function update(i){let tries=0;function attempt(){if(tries++>=photos.length)return;const n=cursor++%photos.length;if(used.some((v,j)=>j!==i&&v===n)){attempt();return}const [src,alt]=photos[n];const probe=new Image();probe.onload=()=>{tiles[i].src=src;tiles[i].alt=alt;used[i]=n};probe.onerror=attempt;probe.src=src}attempt()}tiles.forEach((_,i)=>update(i));let next=0;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)setInterval(()=>{if(document.hidden)return;for(let i=0;i<3;i++)update((next++)%tiles.length)},3000)})();