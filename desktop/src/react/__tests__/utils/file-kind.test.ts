import { describe, expect, it } from 'vitest';
import { inferKindByExt, isMediaKind, EXT_TO_KIND, buildFileRefId, kindOfFileName, isAudioFileName } from '../../utils/file-kind';

describe('inferKindByExt', () => {
  it.each([
    ['png', 'image'], ['jpg', 'image'], ['jpeg', 'image'],
    ['gif', 'image'], ['webp', 'image'], ['bmp', 'image'], ['avif', 'image'],
    ['svg', 'svg'],
    ['mp4', 'video'], ['webm', 'video'], ['mov', 'video'], ['m4v', 'video'], ['mkv', 'video'],
    ['mp3', 'audio'], ['wav', 'audio'], ['ogg', 'audio'], ['flac', 'audio'], ['m4a', 'audio'], ['weba', 'audio'],
    ['pdf', 'pdf'],
    ['docx', 'doc'], ['xlsx', 'doc'], ['xls', 'doc'],
    ['md', 'markdown'], ['markdown', 'markdown'],
    // ── 历史代码 ──
    ['js', 'code'], ['ts', 'code'], ['py', 'code'], ['json', 'code'],
    ['html', 'code'], ['csv', 'code'],
    // ── 新增：纯文本 / 代码全量扩展名 ──
    // JS/TS
    ['mjs', 'code'], ['cjs', 'code'], ['jsx', 'code'], ['mts', 'code'], ['cts', 'code'], ['tsx', 'code'],
    // Web 前端
    ['vue', 'code'], ['svelte', 'code'], ['astro', 'code'],
    ['scss', 'code'], ['sass', 'code'], ['less', 'code'], ['styl', 'code'], ['stylus', 'code'],
    // 模板 / 文档
    ['hbs', 'code'], ['handlebars', 'code'], ['pug', 'code'], ['jade', 'code'],
    ['ejs', 'code'], ['erb', 'code'], ['liquid', 'code'], ['j2', 'code'], ['jinja', 'code'],
    // 数据 / 序列化
    ['json5', 'code'], ['jsonld', 'code'], ['map', 'code'], ['geojson', 'code'], ['ndjson', 'code'],
    ['toml', 'code'], ['yaml', 'code'], ['yml', 'code'],
    ['xml', 'code'], ['xsl', 'code'], ['xsd', 'code'], ['rss', 'code'], ['wsdl', 'code'],
    // Shell
    ['bash', 'code'], ['zsh', 'code'], ['ksh', 'code'], ['fish', 'code'],
    ['ps1', 'code'], ['psd1', 'code'], ['psm1', 'code'], ['bat', 'code'], ['cmd', 'code'],
    // C / C++
    ['h', 'code'], ['ino', 'code'], ['cc', 'code'], ['cxx', 'code'], ['hpp', 'code'], ['hxx', 'code'], ['hh', 'code'],
    // JVM
    ['java', 'code'], ['kt', 'code'], ['kts', 'code'], ['scala', 'code'],
    ['groovy', 'code'], ['gradle', 'code'],
    ['clj', 'code'], ['cljc', 'code'], ['cljs', 'code'],
    // 脚本 / 动态
    ['rb', 'code'], ['rake', 'code'], ['pyw', 'code'],
    ['pl', 'code'], ['pm', 'code'], ['perl', 'code'],
    ['php', 'code'], ['lua', 'code'], ['tcl', 'code'], ['vim', 'code'],
    ['r', 'code'], ['cr', 'code'], ['dart', 'code'],
    // 函数式
    ['hs', 'code'], ['haskell', 'code'], ['ml', 'code'], ['mli', 'code'], ['ocaml', 'code'],
    ['fs', 'code'], ['fsharp', 'code'], ['ex', 'code'], ['exs', 'code'], ['erl', 'code'], ['erlang', 'code'],
    ['elm', 'code'], ['cob', 'code'], ['cobol', 'code'], ['cpy', 'code'],
    ['pas', 'code'], ['pascal', 'code'], ['scm', 'code'], ['scheme', 'code'],
    ['lisp', 'code'], ['cl', 'code'], ['el', 'code'], ['edn', 'code'], ['sml', 'code'],
    ['coffee', 'code'], ['coffeescript', 'code'], ['livescript', 'code'], ['ls', 'code'],
    // 现代 / 系统
    ['go', 'code'], ['rs', 'code'], ['rust', 'code'],
    ['swift', 'code'], ['m', 'code'], ['mm', 'code'],
    ['d', 'code'], ['haxe', 'code'], ['hx', 'code'],
    // 硬件描述
    ['v', 'code'], ['verilog', 'code'], ['sv', 'code'], ['systemverilog', 'code'], ['vhdl', 'code'], ['vhd', 'code'],
    // 数据库 / 查询
    ['sql', 'code'], ['cql', 'code'], ['cypher', 'code'], ['sparql', 'code'],
    ['protobuf', 'code'], ['proto', 'code'], ['graphql', 'code'], ['gql', 'code'],
    // 构建 / 部署
    ['dockerfile', 'code'], ['docker', 'code'], ['cmake', 'code'], ['nginx', 'code'], ['puppet', 'code'],
    // 配置 / 纯文本（未知语言按 txt 展示）
    ['properties', 'code'], ['ini', 'code'], ['in', 'code'], ['cfg', 'code'], ['conf', 'code'], ['htaccess', 'code'],
    ['log', 'code'], ['tsv', 'code'], ['txt', 'code'],
    // 点前缀文件（extOfName 返回整段）
    ['env', 'code'],
    ['gitignore', 'code'], ['gitattributes', 'code'], ['dockerignore', 'code'],
    ['editorconfig', 'code'], ['npmrc', 'code'],
    // 字处理 / 排版
    ['bib', 'code'], ['tex', 'code'], ['dtx', 'code'],
    // 其他
    ['diff', 'code'], ['patch', 'code'],
    ['http', 'code'], ['hxml', 'code'], ['jl', 'code'], ['julia', 'code'],
    ['wat', 'code'], ['wast', 'code'], ['webassembly', 'code'],
    ['asm', 'code'], ['s', 'code'],
  ])('ext %s → kind %s', (ext, kind) => {
    expect(inferKindByExt(ext)).toBe(kind);
  });

  it('大小写混合应正常识别', () => {
    expect(inferKindByExt('PNG')).toBe('image');
    expect(inferKindByExt('Mp4')).toBe('video');
  });

  it('未知/空值 → other', () => {
    expect(inferKindByExt('xyz')).toBe('other');
    expect(inferKindByExt('')).toBe('other');
    expect(inferKindByExt(undefined)).toBe('other');
  });
});

describe('isMediaKind', () => {
  it('image / svg / video → true', () => {
    expect(isMediaKind('image')).toBe(true);
    expect(isMediaKind('svg')).toBe(true);
    expect(isMediaKind('video')).toBe(true);
  });

  it('audio / pdf / doc / code / markdown / other → false', () => {
    expect(isMediaKind('audio')).toBe(false);
    expect(isMediaKind('pdf')).toBe(false);
    expect(isMediaKind('doc')).toBe(false);
    expect(isMediaKind('code')).toBe(false);
    expect(isMediaKind('markdown')).toBe(false);
    expect(isMediaKind('other')).toBe(false);
  });
});

describe('kindOfFileName', () => {
  it('uses mime type when present', () => {
    expect(kindOfFileName('clip.bin', 'audio/webm')).toBe('audio');
    expect(kindOfFileName('still.bin', 'image/png')).toBe('image');
    expect(kindOfFileName('movie.bin', 'video/mp4')).toBe('video');
  });

  it('falls back to the central extension table', () => {
    expect(kindOfFileName('voice.m4a')).toBe('audio');
    expect(kindOfFileName('photo.jpeg')).toBe('image');
  });

  it('detects audio filenames via the same helper', () => {
    expect(isAudioFileName('voice.ogg')).toBe(true);
    expect(isAudioFileName('voice.txt')).toBe(false);
  });
});

describe('buildFileRefId', () => {
  it('desk 源：desk:<path>', () => {
    expect(buildFileRefId({ source: 'desk', path: '/home/u/a.png' }))
      .toBe('desk:/home/u/a.png');
  });

  it('session-attachment 源：sess:<sessionPath>:<messageId>:att:<path>', () => {
    expect(buildFileRefId({
      source: 'session-attachment',
      sessionPath: '/s/1',
      messageId: 'm1',
      path: '/u/pic.png',
    })).toBe('sess:/s/1:m1:att:/u/pic.png');
  });

  it('session-block-file 源：sess:<sessionPath>:<messageId>:block:<blockIdx>:<path>', () => {
    expect(buildFileRefId({
      source: 'session-block-file',
      sessionPath: '/s/1',
      messageId: 'm2',
      blockIdx: 3,
      path: '/out/diagram.svg',
    })).toBe('sess:/s/1:m2:block:3:/out/diagram.svg');
  });

  it('session-block-legacy-artifact 源：sess:<sessionPath>:<messageId>:legacy-artifact:<blockIdx>:<path>', () => {
    expect(buildFileRefId({
      source: 'session-block-legacy-artifact',
      sessionPath: '/s/1',
      messageId: 'm2',
      blockIdx: 4,
      path: '/cache/plan.md',
    })).toBe('sess:/s/1:m2:legacy-artifact:4:/cache/plan.md');
  });

  it('session-block-screenshot 源：path 忽略（为空也 OK）', () => {
    expect(buildFileRefId({
      source: 'session-block-screenshot',
      sessionPath: '/s/1',
      messageId: 'm3',
      blockIdx: 0,
      path: '',
    })).toBe('sess:/s/1:m3:block:0:screenshot');
  });

  it('selector 与调用方用同一函数生成的 id 必须一致', () => {
    const parts = {
      source: 'session-attachment' as const,
      sessionPath: '/x', messageId: 'mid', path: '/p.png',
    };
    // 同样参数调两次 → 相同 id
    expect(buildFileRefId(parts)).toBe(buildFileRefId(parts));
  });
});
