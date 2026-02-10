# Instruções para Desenvolvedores e IA

Este documento centraliza todas as instruções necessárias para conectar um novo projeto de backend ao gateway orquestrador e para garantir que os projetos individuais sejam codificados de forma compatível.

---

## 1. Guia: Adicionando um Novo Projeto ao Gateway

Para adicionar um novo serviço (ex: `novo-servico-backend`), siga estes 3 passos nos arquivos do repositório **orquestrador** (`render`):

### Passo 1: Editar `build.sh`

Adicione o nome exato do novo repositório GitHub ao array `REPOS`.

```shellscript
# /build.sh
REPOS=(
  # ... repositórios existentes
  "novo-servico-backend"
)
```

### Passo 2: Editar `gateway/index.js`

Adicione um novo objeto de serviço ao array `services`. Defina um `path` único para o serviço e uma `target` (porta) que ainda não esteja em uso.

```javascript
// /gateway/index.js
const services = [
  // ... outros serviços
  {
    path: '/novo-servico',
    target: 'http://localhost:3006' // Use uma nova porta
  }
];
```

### Passo 3: Editar o `package.json` da Raiz

Adicione os scripts de instalação e inicialização para o novo serviço.

```json
// /package.json
{
  "scripts": {
    "install:all": "... && (cd services/novo-servico-backend && npm install)",
    "start:novo-servico": "cd services/novo-servico-backend && PORT=3006 npm start"
  }
}
```
**Importante:** A porta definida no script `start:novo-servico` (`PORT=3006`) deve ser a mesma da `target` definida no `gateway/index.js`.

---

## 2. Regras para Projetos de Backend Individuais

Cada projeto de backend (ex: `mindpool-backend`) deve seguir estas regras para ser compatível com o gateway.

### Regra 1: Porta do Servidor
O servidor Node.js/Express **deve** ler a porta da variável de ambiente `process.env.PORT`. O orquestrador injetará este valor em produção. Para desenvolvimento local, use um arquivo `.env` para definir a porta.

### Regra 2: Rotas da API na Raiz
Todas as rotas da API **devem** ser definidas a partir da raiz do servidor (`/`). O gateway é responsável por remover o prefixo do serviço (ex: `/mindpool`) antes de encaminhar a requisição.
- **Correto:** `app.get('/usuarios', ...)`
- **Incorreto:** `app.get('/mindpool/usuarios', ...)`

### Regra 3: Endpoint de Health Check
Cada serviço **deve** implementar uma rota `GET /status` que retorne uma resposta de sucesso (código 200). Isso é essencial para a página de teste de status (`index.html`).

### Regra 4: Variáveis de Ambiente (Segredos)
Segredos como chaves de API e senhas de banco de dados **devem** ser lidos de variáveis de ambiente com prefixo, que são configuradas no painel da Render.
- **Exemplo:** O `mindpool-backend` deve ler sua string de conexão do banco de dados de `process.env.MINDPOOL_DATABASE_URL`.