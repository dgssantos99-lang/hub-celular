# Hub no celular

Uma página que você instala no Android e que conversa com os chats do Hub **usando o seu PC**. O Google Drive é a ponte: o celular escreve os pedidos na pasta `Hub/Ponte` do seu Drive e o Hub, no PC, executa e devolve as respostas e os arquivos. Nada passa por servidor de terceiros e o PC não abre nenhuma porta.

## O que funciona

- Criar projetos, trabalhos (com modelo de cargos) e chats (com cargo, tipo e ícone), e ver as últimas mensagens de cada chat.
- Mandar mensagem para um chat e parar a resposta.
- Ver, ouvir e baixar os arquivos do trabalho que estão no Drive (imagem, áudio, vídeo, texto).
- O assistente geral **não** aparece no celular, de propósito: ele é o único que mexe no app inteiro.

## O que precisa estar ligado

O PC ligado, o Hub aberto e o Google Drive conectado. No Hub: painel do Google Drive › **Deixar o celular usar este PC pelo Google Drive**.

## Instalação (uma vez)

1. **Hospedar a página.** O login do Google só funciona em endereço `https`. O jeito gratuito é o GitHub Pages: crie um repositório, coloque dentro os arquivos desta pasta (`index.html`, `app.js`, `logica.js`, `estilo.css`, `sw.js`, `manifest.webmanifest`, `icone.svg`) e ligue o Pages em Settings › Pages. O endereço será parecido com `https://seu-usuario.github.io/hub-celular/`.
2. **Criar o cliente do Google.** No Google Cloud, no mesmo projeto do Hub: APIs e serviços › Credenciais › Criar credenciais › ID do cliente OAuth › tipo **Aplicativo da Web**. Em "Origens JavaScript autorizadas" coloque só a origem, sem caminho (por exemplo `https://seu-usuario.github.io`). Copie o ID do cliente.
3. **Tela de consentimento em produção.** Em "Tela de permissão OAuth", mude de "Em teste" para "Em produção". Sem isso o login vence a cada 7 dias.
4. **No celular:** abra o endereço no Chrome, cole o ID do cliente, entre com a **mesma conta do Google** que o Hub usa, e toque em ⋮ › **Adicionar à tela inicial**.

## Segurança

- Quem tem acesso de edição à pasta `Hub/Ponte` pode mandar mensagens aos chats. Não compartilhe essa pasta.
- O login do celular é guardado só no navegador do aparelho e vale por cerca de 1 hora; a página pede de novo sozinha.
- As ações que o assistente geral pede com aprovação continuam só no PC.
