#!/bin/bash
# End-to-end smoke test of the server API. Server must be running on :3210.
set -e
B=http://127.0.0.1:3210
J=./_t; mkdir -p $J
say() { echo; echo "== $* =="; }

say "owner login"
curl -sf -X POST $B/api/owner/login -H 'content-type: application/json' -d '{"key":"test-master-123"}' -c $J/owner.txt >/dev/null && echo ok

say "create teacher"
curl -sf -X POST $B/api/owner/teachers -b $J/owner.txt -H 'content-type: application/json' \
  -d '{"username":"flow","name":"Flow Teacher","password":"pw"}' >/dev/null && echo ok || echo "(exists, ok)"

say "teacher login"
curl -sf -X POST $B/api/teacher/login -H 'content-type: application/json' -d '{"username":"flow","password":"pw"}' -c $J/t.txt | tr -d '\n'; echo

say "import exponents PDF"
curl -sf -X POST $B/api/teacher/import -b $J/t.txt -F "file=@../test/fixtures/exponents.pdf" -o $J/import.json
node -e "const j=require('$J/import.json'); console.log('candidates',j.candidates.length,'keyPages',j.keyPageCount,'pages',j.pages.length); require('fs').writeFileSync('$J/deck.json', JSON.stringify({name:'Exponents',subject:'Algebra 1',stashId:j.stashId,ext:j.ext,pages:j.pages,cards:j.candidates.map((c,i)=>({id:String(i+1),question:c.question,answer:c.answer,hint:'',typeLabel:c.typeLabel,page:c.page}))}));"

say "save deck"
DID=$(curl -sf -X POST $B/api/teacher/decks -b $J/t.txt -H 'content-type: application/json' -d @$J/deck.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
echo "deck id: $DID"

say "publish with class code ABC"
curl -sf -X POST $B/api/teacher/decks/$DID/publish -b $J/t.txt -H 'content-type: application/json' -d '{"published":true,"classCode":"ABC"}' | tr -d '\n'; echo

say "student sees it"
curl -sf $B/api/decks | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.map(x=>x.name+' ('+x.cardCount+' cards, code:'+x.needsCode+')').join('\n'))})"

say "student loads deck — wrong code"
curl -s -X POST $B/api/decks/$DID -H 'content-type: application/json' -d '{"code":"nope"}' | tr -d '\n'; echo
say "student loads deck — right code"
curl -sf -X POST $B/api/decks/$DID -H 'content-type: application/json' -d '{"code":"ABC"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('cards',j.cards.length,'pages',j.pages.length,'| #1',JSON.stringify(j.cards[0].question),'=>',JSON.stringify(j.cards[0].answer))})"

say "student posts a run"
curl -sf -X POST $B/api/progress -H 'content-type: application/json' -d "{\"student\":\"Alex\",\"deckId\":\"$DID\",\"run\":{\"total\":22,\"retried\":3,\"seconds\":240,\"perfect\":false}}" | tr -d '\n'; echo

say "teacher sees results"
curl -sf $B/api/teacher/decks/$DID/results -b $J/t.txt | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)))"

say "cleanup: delete deck"
curl -sf -X DELETE $B/api/teacher/decks/$DID -b $J/t.txt | tr -d '\n'; echo
rm -rf ./_t
echo; echo "ALL OK"
