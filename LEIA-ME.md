# Hub no celular

Uma página que você instala no Android e que conversa com os chats do Hub **usando o seu PC**. O Google Drive é a ponte: o celular escreve os pedidos na pasta `Hub/Ponte` do seu Drive e o Hub, no PC, executa e devolve as respostas e os arquivos. Nada passa por servidor de terceiros e o PC não abre nenhuma porta.

## O que funciona

- Projetos, trabalhos e chats: ver, criar (trabalho com modelo de cargos, chat com cargo, tipo e ícone), renomear e mandar para a lixeira.
- Conversar com os chats em tela estilo mensageiro, mandar fotos, áudios e arquivos junto da mensagem, e parar a resposta.
- Trocar o ícone e o modelo do Claude de cada chat, e enviar arquivos do celular para um trabalho.
- Ver, ouvir e baixar os arquivos do trabalho que estão no Drive (imagem, áudio, vídeo, texto).
- O **assistente geral** está na aba Assistente. As ações que ele pede ficam esperando a sua aprovação, que pode ser dada pelo celular ou pelo PC.
- Mensagem de voz: toque no microfone e fale. Por padrão, quem entende é o reconhecimento do próprio celular (precisa de internet e do Chrome); em Ajustes › Voz, dá para escolher o PC (Whisper), mais preciso, mas que precisa do PC ligado e do modelo de voz baixado no Hub.
- Temas, cor de destaque e o gasto do mês.

## O que precisa estar ligado

O PC ligado, o Hub aberto e o Google Drive conectado. No Hub: painel do Google Drive › **Deixar o celular usar este PC pelo Google Drive**.

## Instalação (uma vez)

1. **Hospedar a página.** O login do Google só funciona em endereço `https`. O jeito gratuito é o GitHub Pages: crie um repositório público, coloque dentro os arquivos desta pasta e ligue o Pages em Settings › Pages. O endereço será parecido com `https://seu-usuario.github.io/hub-celular/`.
2. **Criar o cliente do Google.** No Google Cloud, no mesmo projeto do Hub: APIs e serviços › Credenciais › Criar credenciais › ID do cliente OAuth › tipo **Aplicativo da Web**.
   - Em **Origens JavaScript autorizadas**: só a origem, sem caminho (por exemplo `https://seu-usuario.github.io`).
   - Em **URIs de redirecionamento autorizados**: o endereço completo da página, com a barra no final (por exemplo `https://seu-usuario.github.io/hub-celular/`). A tela de configuração da página mostra o endereço exato e tem o botão de copiar.
   - Copie o **ID do cliente** e a **chave secreta**.
3. **Tela de consentimento em produção.** Em "Tela de permissão OAuth", mude de "Em teste" para "Em produção". Sem isso a permissão duradoura vence a cada 7 dias.
4. **No celular:** abra o endereço no Chrome, cole o ID e a chave secreta (ficam só no aparelho), toque em **Entrar com o Google** e aceite. Depois use ⋮ › **Adicionar à tela inicial**.

O login fica guardado: a página renova o próprio acesso sozinha e não pede para entrar de novo, a não ser que você revogue o acesso na sua conta do Google.

## Segurança

- Quem tem acesso de edição à pasta `Hub/Ponte` pode mandar mensagens aos chats, inclusive ao assistente. Não compartilhe essa pasta.
- O ID, a chave secreta e a permissão duradoura ficam só no navegador do aparelho. Se perder o celular, revogue o acesso em myaccount.google.com/permissions.
- Quem controla a pasta Hub/Ponte também consegue aprovar ações do assistente. Por isso, mantenha a conta do Google protegida.
