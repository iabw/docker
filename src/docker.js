// # docker.js
// ### _A simple documentation generator based on [docco](http://jashkenas.github.com/docco/)_
// **Docker** is a really simple documentation generator, which originally started out as a
// pure-javascript port of **docco**, but which eventually gained many extra little features
// which somewhat break docco's philosophy of being a quick-and-dirty thing.
//
// Docker source-code can be found on [GitHub](https://github.com/jbt/docker)
//
// Take a look at the [original docco project](http://jashkenas.github.com/docco/) to get a feel
// for the sort of functionality this provides. In short: **Markdown**-based displaying of code comments
// next to syntax-highlighted code. This page is the result of running docker against itself.
//
// The command-line usage of docker is somewhat more useful than that of docco. To use, simply run
//
// ```sh
// ./docker -i path/to/code -o path/to/docs [a_file.js a_dir]
// ```
//
// Docker will then recurse into the code root directory (or alternatively just the files
// and directories you specify) and document-ize all the files it can.
// The folder structure will be preserved in the document root.
//
// ## Differences from docco
// The main differences from docco are:
//
//  - **jsDoc support**: support for **jsDoc**-style code comments, which
// is provided by way of [Dox](https://github.com/visionmedia/dox). You can see some examples of
// the sort of output you get below.
//
//  - **Folder Tree**: collabsible folder tree suitable for browsing and navigating the many code files
// that constitute a large-scale project
//
//  - **Markdown File Support**: support for plain markdown files, like the [README](../README.md.html) for this project.
//
// So let's get started!


// ## Node Modules
// Include all the necessay node modules.
var mkdirp = require('mkdirp'),
  fs = require('fs'),
  dox = require('dox'),
  path = require('path'),
  spawn = require('child_process').spawn,
  showdown = require('../lib/showdown').Showdown;

/**
 * ## Docker Constructor
 *
 * Creates a new docker instance. All methods are called on one instance of this object.
 *
 * @constructor
 * @this {Docker}
 * @param {string} inDir The root directory containing all the code files
 * @param {string} outDir The directory into which to put all the doc pages
 * @param {boolean} onlyUpdated Whether to only process files that have been updated
 */
var Docker = module.exports =function(inDir, outDir, onlyUpdated){
  this.inDir = inDir.replace(/\/$/,'');
  this.outDir = outDir;
  this.onlyUpdated = !!onlyUpdated;
  this.running = false;
  this.scanQueue = [];
  this.files = [];
  this.tree = {};
};

/**
 * ## Docker.prototype.doc
 *
 * Generate documentation for a bunch of files
 *
 * @this Docker
 * @param {Array} files Array of file paths relative to the `inDir` to generate documentation for.
 */
Docker.prototype.doc = function(files){
  this.scanQueue = files;
  this.addNextFile();
};

/**
 * ## Docker.prototype.addNextFile
 *
 * Process the next file on the scan queue. If it's a directory, list all the children and queue those.
 * If it's a file, add it to the queue.
 */
Docker.prototype.addNextFile = function(){
  if(this.scanQueue.length > 0){
    var self = this, filename = this.scanQueue.shift();
    fs.stat(path.join(this.inDir, filename), function(err, stat){
      if(stat && stat.isDirectory()){
        // Find all children of the directory and queue those
        fs.readdir(path.join(self.inDir, filename), function(err, list){
          for(var i = 0; i < list.length; i += 1) self.scanQueue.push(path.join(filename, list[i]));
            self.addNextFile();
        });
      }else{
        self.queueFile(filename);
        self.addNextFile();
      }
    });
  }else{
    // Once we're done scanning all the files, start processing them in order.
    this.processNextFile();
  }
};

/**
 * ## Docker.prototype.queueFile
 *
 * Queues a file for processing, and additionally stores it in the folder tree
 *
 * @param {string} filename Name of the file to queue
 */
Docker.prototype.queueFile = function(filename){
  if(!this.canHandleFile(filename)) return;
  this.files.push(filename);

  // Split the file's path into the individual directories
  filename = filename.replace(/^\//,'');
  var bits = filename.split('/');

  // Loop through all the directories and process the folder structure into `this.tree`.
  //
  // `this.tree` takes the format:
  // ```js
  //  {
  //    dirs: {
  //      'child_dir_name': { /* same format as tree */ },
  //      'other_child_name': // etc...
  //    },
  //    files: [
  //      'filename.js',
  //      'filename2.js',
  //      // etc...
  //    ]
  //  }
  // ```
  var currDir  = this.tree;
  for(var i = 0; i < bits.length - 1; i += 1){
    if(!currDir.dirs) currDir.dirs = {};
    if(!currDir.dirs[bits[i]])currDir.dirs[bits[i]] = {};
    currDir = currDir.dirs[bits[i]];
  }
  if(!currDir.files) currDir.files = [];
  currDir.files.push(bits[bits.length-1]);
};

/**
 * ## Docker.prototype.processNextFile
 *
 * Take the next file off the queue and process it
 */
Docker.prototype.processNextFile = function(){
  var self = this;

  // If we still have files on the queue, process the first one
  if(this.files.length > 0){
    this.generateDoc(this.files.shift(), function(){
      self.processNextFile();
    });
  }else{
    this.copySharedResources();
  }
};

/**
 * ## Docker.prototype.canHandleFile
 *
 * Check to see whether or not we can process a given file
 * For now, we can only do javascript and markdown files
 *
 * @param {string} filename File name to test
 */
Docker.prototype.canHandleFile = function(filename){
  return this.languageParams(filename) !== false;
};

/**
 * ## Docker.prototype.generateDoc
 * ### _This is where the magic happens_
 *
 * Generate the documentation for a file
 *
 * @param {string} filename File name to generate documentation for
 * @param {function} cb Callback function to execute when we're done
 */
Docker.prototype.generateDoc = function(filename, cb){
  var self = this;
  this.running = true;
  filename = path.join(this.inDir, filename);
  this.decideWhetherToProcess(filename, function(shouldProcess){
    if(!shouldProcess) return cb();
    fs.readFile(filename, 'utf-8', function(err, data){
      if(err) throw err;
      var l = self.languageParams(filename);
      switch(l.type){
        case 'markdown':
          self.renderMarkdownHtml(data, filename, cb);
          break;
        default:
        case 'code':
          var sections = self.parseSections(data, filename);
          self.highlight(sections, filename, function(){
            self.renderCodeHtml(sections, filename, cb);
          });
          break;
      }
    });
  });
};

/**
 * ## Docker.prototype.decideWhetherToProcess
 *
 * Decide whether or not a file should be processed. If the `onlyUpdated`
 * flag was set on initialization, only allow processing of files that
 * are newer than their counterpart generated doc file.
 *
 * Fires a callback function with either true or false depending on whether
 * or not the file should be processed
 *
 * @param {string} filename The name of the file to check
 * @param {function} callback Callback function
 */
Docker.prototype.decideWhetherToProcess = function(filename, callback){

  // If we should be processing all files, then yes, we should process this one
  if(!this.onlyUpdated) return callback(true);

  // Find the doc this file would be compiled to
  var outFile = this.outFile(filename);

  // Stat the files
  fs.stat(outFile, function(err, outStat){

    // If the output file doesn't exist, then definitely process this file
    if(err && err.code == 'ENOENT') return callback(true);

    fs.stat(filename, function(err, inStat){
      // Process the file if the input is newer than the output
      callback(+inStat.mtime > +outStat.mtime);
    });
  });
};

/**
 * ## Docker.prototype.parseSections
 *
 * Parse the content of a file into individual sections.
 * A section is defined to be one block of code with an accompanying comment
 *
 * Returns an array of section objects, which take the form
 * ```js
 *  {
 *    doc_text: 'foo', // String containing comment content
 *    code_text: 'bar' // Accompanying code
 *  }
 * ```
 * @param {string} data The contents of the script file
 * @param {string} filename The name of the script file

 * @return {Array} array of section objects
 */
Docker.prototype.parseSections = function(data, filename){
  var codeLines = data.split('\n');
  var sections = [];

  // Fetch language-specific parameters for this code file
  var params = this.languageParams(filename);
  var section = {
    docs: '',
    code: ''
  };
  var inMultiLineComment = false;
  var multiLine = '';
  var doxData;

  function md(a, stripParas){
    var h = showdown.makeHtml(a.replace(/(^\s*|\s*$)/,''));
    return stripParas ? h.replace(/<\/?p>/g,'') : h;
  }

  var commentRegex = new RegExp('^\\s*' + params.comment + '\\s?');

  // Loop through all the lines, and parse into sections
  for(var i = 0; i < codeLines.length; i += 1){
    var line = codeLines[i];
    if(params.multiLine){
      // If we are currently in a multiline comment, behave differently
      if(inMultiLineComment){
        if(line.match(params.multiLine[1])){
          // Once we have reached the end of the multiline, take the whole content
          // of the multiline comment, and pass it through **dox**, which will then
          // extract any **jsDoc** parameters that are present.
          inMultiLineComment = false;
          if(params.dox){
            multiLine += line + '\n';
            try{
              doxData = dox.parseComments(multiLine, {raw: true})[0];
              // Don't let dox do any markdown parsing. We'll do that all ourselves with md above
              doxData.md = md;
              section.docs += this.doxTemplate(doxData);
            }catch(e){
              console.log("Dox error: " + e);
              multiLine += line.replace(params.multiLine[1],'') + '\n';
              section.docs += '\n' + multiLine.replace(params.multiLine[0],'') + '\n';
            }
          }else{
            multiLine += line.replace(params.multiLine[1],'') + '\n';
            section.docs += '\n' + multiLine.replace(params.multiLine[0],'') + '\n';
          }
          multiLine = '';
        }else{
          multiLine += line + '\n';
        }
        continue;
      }else if(
        // We want to match the start of a multiline comment only if the line doesn't also match the
        // end of the same comment, or if a single-line comment is started before the multiline
        // So for example the following would not be treated as a multiline starter:
        // ```js
        //  alert('foo'); // Alert some foo /* Random open comment thing
        // ```
        line.match(params.multiLine[0]) &&
        !line.replace(params.multiLine[0],'').match(params.multiLine[1]) &&
        !line.split(params.multiLine[0])[0].match(commentRegex)){
        // Here we start parsing a multiline comment. Store away the current section and start a new one
        if(section.code){
          if(!section.code.match(/^\s*$/) || !section.docs.match(/^\s*$/)) sections.push(section);
          section = { docs: '', code: '' };
        }
        inMultiLineComment = true;
        multiLine = line;
        continue;
      }
    }
    if(line.match(commentRegex) && (!params.commentsIgnore || !line.match(params.commentsIgnore))){
      // This is for single-line comments. Again, store away the last section and start a new one
      if(section.code){
        if(!section.code.match(/^\s*$/) || !section.docs.match(/^\s*$/)) sections.push(section);
        section = { docs: '', code: '' };
      }
      section.docs += line.replace(commentRegex, '') + '\n';
    }else if(!params.commentsIgnore || !line.match(params.commentsIgnore)){
      section.code += line + '\n';
    }
  }
  sections.push(section);
  return sections;
};

/**
 * ## Docker.prototype.languageParams
 *
 * Provides language-specific params for a given file name.
 *
 * @param {string} filename The name of the file to test
 * @return {object} Object containing all of the language-specific params
 */
Docker.prototype.languageParams = function(filename){
  switch(path.extname(filename)){
    // The language params can have the following keys:
    //
    //  * `name`: Name of Pygments lexer to use
    //  * `comment`: String flag for single-line comments
    //  * `multiline`: Two-element array of start and end flags for block comments
    //  * `commentsIgnore`: Regex of comments to strip completely (don't even doc)
    //  * `dox`: Whether to run block comments through Dox (only JavaScript)
    //  * `type`: Either `'code'` (default) or `'markdown'` - format of page to render
    //
    case '.js':
      return { name: 'javascript',   comment: '//', multiLine: [ /\/\*/, /\*\// ], commentsIgnore: /^\s*\/\/=/, dox: true };
    case '.coffee':
      return { name: 'coffeescript', comment: '#',  multiLine: [ /^#{3}$/, /^#{3}$/ ] };
    case '.rb':
      return { name: 'ruby',         comment: '#',  multiLine: [ /\=begin/, /\=end/ ] };
    case '.py':
      return { name: 'python',       comment: '#'   }; // Python has no block commments :-(
    case '.c':
    case '.h':
      return { name: 'c',            comment: '//', multiLine: [ /\/\*/, /\*\// ]     };
    case '.cc':
    case '.cpp':
      return { name: 'cpp',          comment: '//', multiLine: [ /\/\*/, /\*\// ]     };
    case '.cs':
      return { name: 'csharp',       comment: '//', multiLine: [ /\/\*/, /\*\// ]     };
    case '.java':
      return { name: 'java',         comment: '//', multiLine: [ /\/\*/, /\*\// ]     };
    case '.md':
    case '.mkd':
    case '.markdown':
      return { name: 'markdown', type: 'markdown' };
    default:
      return false;
  }
};

/**
 * ## Docker.prototype.pygments
 *
 * Runs a given block of code through pygments
 *
 * @param {string} data The code to give to Pygments
 * @param {string} language The name of the Pygments lexer to use
 * @param {function} cb Callback to fire with Pygments output
 */
Docker.prototype.pygments = function(data, language, cb){
  // By default tell Pygments to guess the language, and if
  // we have a language specified then tell pygments to use that lexer
  var pygArgs = ['-g'];
  if(language) pygArgs = ['-l', language];

  // Spawn a new **pygments** process
  var pyg = spawn('pygmentize', pygArgs.concat(['-f', 'html', '-O', 'encoding=utf-8,tabsize=2']));

  // Hook up errors, for either when pygments itself throws an error,
  // or for when we're unable to send the code to pygments for some reason
  pyg.stderr.on('data', function(err){ console.error(err.toString()); });
  pyg.stdin.on('error', function(err){
    console.error('Unable to write to Pygments stdin: ' , err);
    process.exit(1);
  });

  var out = '';
  pyg.stdout.on('data', function(data){ out += data.toString(); });

  // When pygments is done, fire the callback with our output
  pyg.on('exit', function(){
    cb(out);
  });

  // Feed pygments with the code
  if(pyg.stdin.writable){
    pyg.stdin.write(data);
    pyg.stdin.end();
  }
};

/**
 * ## Docker.prototype.highlight
 *
 * Highlights all the sections of a file using **pygments**
 * Given an array of section objects, loop through them, and for each
 * section generate pretty html for the comments and the code, and put them in
 * `docHtml` and `codeHtml` respectively
 *
 * @param {Array} sections Array of section objects
 * @param {string} filename Name of the file being processed
 * @param {function} cb Callback function to fire when we're done
 */
Docker.prototype.highlight = function(sections, filename, cb){
  var params = this.languageParams(filename), self = this;

  var input = [];
  for(var i = 0; i < sections.length; i += 1){
    input.push(sections[i].code);
  }
  input = input.join('\n' + params.comment + '----{DIVIDER_THING}----\n');

  // Run our input through pygments, then split the output back up into its constituent sections
  this.pygments(input, params.name, function(out){
    out = out.replace(/^\s*<div class="highlight"><pre>/,'').replace(/<\/pre><\/div>\s*$/,'');
    var bits = out.split(new RegExp('\\n*<span class="c1?">' + params.comment + '----\\{DIVIDER_THING\\}----<\\/span>\\n*'));
    for(var i = 0; i < sections.length; i += 1){
      sections[i].codeHtml = '<div class="highlight"><pre>' + bits[i] + '</pre></div>';
      sections[i].docHtml = showdown.makeHtml(sections[i].docs);
    }
    self.processDocCodeBlocks(sections, cb);
  });
};

/**
 * ## Docker.prototype.processDocCodeBlocks
 *
 * Goes through all the HTML generated from comments, finds any code blocks
 * and highlights them
 *
 * @param {Array} sections Sections array as above
 * @param {function} cb Callback to fire when done
 */
Docker.prototype.processDocCodeBlocks = function(sections, cb){
  var i = 0, self = this;

  function next(){
    // If we've reached the end of the sections array, we've highlighted everything,
    // so we can stop and fire the callback
    if(i == sections.length) return cb();

    // Process the code blocks on this section, each time returning the html
    // and moving onto the next section when we're done
    self.extractDocCode(sections[i].docHtml, function(html){
      sections[i].docHtml = html;
      i = i + 1;
      next();
    });
  }

  // Start off with the first section
  next();
};

/**
 * ## Docker.prototype.extractDocCode
 *
 * Extract and highlight code blocks in formatted HTML output from showdown
 *
 * @param {string} html The HTML to process
 * @param {function} cb Callback function to fire when done
 */
Docker.prototype.extractDocCode = function(html, cb){

  // We'll store all extracted code blocks, along with information, in this array
  var codeBlocks = [];

  // Search in the HTML for any code tag with a language set (in the format that showdown returns)
  html = html.replace(/<pre><code\slanguage='([a-z]+)'>([^<]*)<\/code><\/pre>/g, function(wholeMatch, language, block){
    // Unescape these HTML entities because they'll be re-escaped by pygments
    block = block.replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/,'&');

    // Store the code block away in `codeBlocks` and leave a flag in the original text.
    return "\n\n~C" + codeBlocks.push({
      language: language,
      code: block,
      i: codeBlocks.length + 1
    }) + "C\n\n";
  });

  // Once we're done with that, now we can move on to highlighting the code we've extracted
  this.highlighExtractedCode(html, codeBlocks, cb);
};

/**
 * ## Docker.prototype.highlightExtractedCode
 *
 * Loops through all extracted code blocks and feeds them through pygments
 * for code highlighting. Unfortunately the only way to do this that's able
 * to cater for all situations is to spawn a new pygments process for each
 * code block (as different blocks might be in different languages). If anyone
 * knows of a more efficient way of doing this, please let me know.
 *
 * @param {string} html The HTML the code has been extracted from
 * @param {Array} codeBlocks Array of extracted code blocks as above
 * @param {function} cb Callback to fire when we're done with processed HTML
 */
Docker.prototype.highlighExtractedCode = function(html, codeBlocks, cb){

  var self = this;

  function next(){
    // If we're done, then stop and fire the callback
    if(codeBlocks.length === 0) return cb(html);

    // Pull the next code block off the beginning of the array
    var nextBlock = codeBlocks.shift();

    // Run the code through pygments
    self.pygments(nextBlock.code, nextBlock.language, function(out){
      out = out.replace(/<pre>/,'<pre><code>').replace(/<\/pre>/,'</code></pre>');
      html = html.replace('\n~C' + nextBlock.i + 'C\n', out);
      next();
    });
  }

  // Fire off on first block
  next();
};

/**
 * ## Docker.prototype.addAnchors
 *
 * Automatically assign an id to each section based on any headings.
 *
 * @param {object} section The section object to look at
 * @param {number} idx The index of the section in the whole array.
 */
Docker.prototype.addAnchors = function(docHtml, idx, headings){
  if(docHtml.match(/<h[0-9]>/)){
    // If there is a heading tag, pick out the first one (likely the most important), sanitize
    // the name a bit to make it more friendly for IDs, then use that
    docHtml = docHtml.replace(/(<h([0-9])>)(.*)(<\/h\2>)/g, function(a, start, level, middle, end){
      var id = middle.replace(/<[^>]*>/g,'').toLowerCase().replace(/[^a-zA-Z0-9\_\.]/g,'-');
      headings.push({ id: id, text: middle.replace(/<[^>]*>/g,''), level: level });
      return '\n<div class="pilwrap" id="' + id + '">\n  '+
                start +
                '\n    <a href="#' + id + '" class="pilcrow">&#182;</a>\n    ' +
                middle + '\n  ' +
                end +
              '\n</div>\n';
    });
  }else{
    // If however we can't find a heading, then just use the section index instead.
    docHtml = '\n<div class="pilwrap">' +
              '\n  <a class="pilcrow" href="#section-' + (idx+1)+ '" id="section-' +(idx + 1) +'">&#182;</a>' +
              '\n</div>\n' + docHtml;
  }
  return docHtml;
};

/**
 * ## Docker.prototype.renderCodeHtml
 *
 * Given an array of sections, render them all out to a nice HTML file
 *
 * @param {Array} sections Array of sections containing parsed data
 * @param {string} filename Name of the file being processed
 * @param {function} cb Callback function to fire when we're done
 */
Docker.prototype.renderCodeHtml = function(sections, filename, cb){

  // Decide which path to store the output on.
  var outFile = this.outFile(filename);

  var headings = [];

  // Calculate the location of the input root relative to the output file.
  // This is necessary so we can link to the stylesheet in the output HTML using
  // a relative href rather than an absolute one
  var outDir = path.dirname(outFile);
  var relDir = '';
  while(path.join(outDir, relDir).replace(/\/$/,'') !== this.outDir.replace(/\/$/,'')){
    relDir += '../';
  }

  for(var i = 0; i < sections.length; i += 1){
    sections[i].docHtml = this.addAnchors(sections[i].docHtml, i, headings);
  }

  // Render the html file using our template
  var content = this.codeFileTemplate({
    sections: sections
  });
  var html = this.renderTemplate({
    title: path.basename(filename),
    relativeDir: relDir,
    content: content,
    headings: headings,
    filename: filename.replace(this.inDir,'').replace(/^\//,'')
  });

  var self = this;

  // Recursively create the output directory, clean out any old version of the
  // output file, then save our new file.
  mkdirp(outDir, function(){
    fs.unlink(outFile, function(){
      fs.writeFile(outFile, html, function(){
        console.log('Generated: ' + outFile.replace(self.outDir,''));
        cb();
      });
    });
  });
};

/**
 * ## Docker.prototype.renderMarkdownHtml
 *
 * Renders the output for a Markdown file into HTML
 *
 * @param {string} content The markdown file content
 * @param {string} filename Name of the file being processed
 * @param {function} cb Callback function to fire when we're done
 */
Docker.prototype.renderMarkdownHtml = function(content, filename, cb){
  // Run the markdown through *showdown*
  content = showdown.makeHtml(content);

  this.extractDocCode(content, function(content){

    var headings = [];

    // Add anchors to all headings
    content = this.addAnchors(content,0, headings);

    // Wrap up with necessary classes
    content = '<div class="docs markdown">' + content + '</div>';

    // Decide which path to store the output on.
    var outFile = this.outFile(filename);

    // Calculate the location of the input root relative to the output file.
    // This is necessary so we can link to the stylesheet in the output HTML using
    // a relative href rather than an absolute one
    var outDir = path.dirname(outFile);
    var relDir = '';
    while(path.join(outDir, relDir).replace(/\/$/,'') !== this.outDir.replace(/\/$/,'')){
      relDir += '../';
    }

    // Render the html file using our template
    var html = this.renderTemplate({
      title: path.basename(filename),
      relativeDir: relDir,
      content: content,
      headings: headings,
      filename: filename.replace(this.inDir,'').replace(/^\//,'')
    });

    var self = this;

    // Recursively create the output directory, clean out any old version of the
    // output file, then save our new file.
    mkdirp(outDir, function(){
      fs.unlink(outFile, function(){
        fs.writeFile(outFile, html, function(){
          console.log('Generated: ' + outFile.replace(self.outDir,''));
          cb();
        });
      });
    });
  }.bind(this));
};

/**
 * ## Docker.prototype.copySharedResources
 *
 * Copies the shared CSS and JS files to the output directories
 */
Docker.prototype.copySharedResources = function(){
  var self = this;
  function copy(from, to){
    fs.unlink(path.join(self.outDir, to), function(){
      fs.readFile(path.join(path.dirname(__filename),'../', from), function(err, file){
        fs.writeFile(path.join(self.outDir, to), file, function(){
          console.log('Copied ' + from + ' to ' + to);
        });
      });
    });
  }

  fs.unlink(path.join(this.outDir, 'doc-filelist.js'), function(){
    fs.writeFile(path.join(self.outDir, 'doc-filelist.js'), 'var tree=' + JSON.stringify(self.tree) + ';', function(){
      copy('res/style.css', 'doc-style.css');
      copy('res/script.js', 'doc-script.js');
    });
  });
};

/**
 * ## Docker.prototype.outFile
 *
 * Generates the output path for a given input file
 *
 * @param {string} filename Name of the input file
 * @return {string} Name to use for the generated doc file
 */
Docker.prototype.outFile = function(filename){
  return filename.replace(this.inDir, this.outDir) + '.html';
};

/**
 * ## Docker.prototype.compileTemplate
 *
 * Tiny template compilation function
 *
 * @param {string} str Template content
 * @return {function} Compiled template function
 */
Docker.prototype.compileTemplate = function(str){
  return new Function('obj', 'var p=[],print=function(){p.push.apply(p,arguments);};' +
    'with(obj){p.push(\'' +
    str.replace(/[\r\t]/g, " ")
       .replace(/(>)\s*\n+(\s*<)/g,'$1\n$2')
       .replace(/(?=<%[^=][^%]*)%>\s*\n*\s*<%(?=[^=])/g,'')
       .replace(/%>\s*(?=\n)/g,'%>')
       .replace(/(?=\n)\s*<%/g,'<%')
       .replace(/\n/g,"~K")
       .replace(/~K(?=[^%]*%>)/g, " ")
       .replace(/~K/g, '\\n')
       .replace(/'(?=[^%]*%>)/g, "\t")
       .split("'").join("\\'")
       .split("\t").join("'")
       .replace(/<%=(.+?)%>/g, "',$1,'")
       .split('<%').join("');")
       .split('%>').join("p.push('") +
    "');}return p.join('');");
};

/**
 * ## Docker.prototype.renderTemplate
 *
 * Renders the HTML for an output page with given parameters
 *
 * @param {object} obj Object containing parameters for the template
 * @return {string} Rendered doc page
 */
Docker.prototype.renderTemplate = function(obj){
  // If we haven't already loaded the template, load it now.
  // It's a bit messy to be using readFileSync I know, but this
  // is the easiest way for now.
  if(!this.__tmpl){
    var tmplFile = path.join(path.dirname(__filename),'../res/tmpl.jst');
    this.__tmpl = this.compileTemplate(fs.readFileSync(tmplFile).toString());
  }
  return this.__tmpl(obj);
};

/**
 * ## Docker.prototype.codeFileTemplate
 *
 * Renders the content for a code file's doc page
 *
 * @param {object} obj Object containing parameters for the template
 * @return {string} Rendered content
 */
Docker.prototype.codeFileTemplate = function(obj){
  if(!this.__codeTmpl){
    var tmplFile = path.join(path.dirname(__filename),'../res/code.jst');
    this.__codeTmpl = this.compileTemplate(fs.readFileSync(tmplFile).toString());
  }
  return this.__codeTmpl(obj);
};

/**
 * ## Docker.prototype.doxTemplate
 *
 * Renders the output of **dox** into a format suitable for compilation
 *
 * @param {object} obj Object containing output of dox
 * @return {string} Rendered output of dox properties
 */
Docker.prototype.doxTemplate = function(obj){
  if(!this.__doxtmpl){
    var tmplFile = path.join(path.dirname(__filename), '../res/dox.jst');
    this.__doxtmpl = this.compileTemplate(fs.readFileSync(tmplFile).toString());
  }
  return this.__doxtmpl(obj);
};