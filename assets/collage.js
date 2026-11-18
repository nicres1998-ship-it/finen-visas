(()=>{'use strict';const root=document.getElementById('finenCollage');if(!root)return;root.replaceChildren();const images=[
['https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=900&q=85','Vuelo internacional'],
['https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=900&q=85','Documentos de viaje'],
['https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=900&q=85','Orientación y entrevista'],
['https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=900&q=85','Estudiantes internacionales'],
['https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=900&q=85','Personas en formación'],
['https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=900&q=85','Viajeros'],
['https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=900&q=85','Entrevista laboral'],
['https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=85','Viaje y destino'],
['https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=900&q=85','Formación'],
['https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=900&q=85','Capacitación profesional'],
['https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=900&q=85','Reunión de trabajo'],
['https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=900&q=85','Destino internacional'],
['https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=900&q=85','Arquitectura'],
['https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=900&q=85','Universidad'],
['https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=900&q=85','Trabajo gastronómico']];
const spots=[[-7,-8,43,40,-11,2],[28,-8,43,42,8,3],[67,-7,40,44,12,4],[-9,26,43,45,9,5],[26,25,47,49,-8,8],[66,28,42,45,-12,7],[-7,64,43,44,-8,9],[29,64,44,45,10,11],[67,65,42,43,7,10]];const tiles=spots.map((s,i)=>{const d=document.createElement('div');d.className='finen-tile';d.style.cssText='--x:'+s[0]+'%;--y:'+s[1]+'%;--w:'+s[2]+'%;--h:'+s[3]+'%;--rot:'+s[4]+'deg;--layer:'+s[5];const im=document.createElement('img');im.loading='eager';im.decoding='async';d.append(im);root.append(d);return im});let index=0;const assigned=new Array(tiles.length).fill(-1);function swap(i){let attempts=0;function tryNext(){if(attempts++>=images.length)return;const n=index++%images.length;if(assigned.some((v,j)=>j!==i&&v===n))return tryNext();const [src,alt]=images[n];const pre=new Image();pre.onload=()=>{tiles[i].src=src;tiles[i].alt=alt;assigned[i]=n};pre.onerror=tryNext;pre.src=src}tryNext()}tiles.forEach((_,i)=>swap(i));let pointer=0;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)setInterval(()=>{if(!document.hidden){for(let i=0;i<3;i++)swap(pointer++%tiles.length)}},3000)})();