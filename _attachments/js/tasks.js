
window.log = function() {
  log.history = log.history || [];
  log.history.push(arguments);
  if(this.console){
    console.log( Array.prototype.slice.call(arguments) );
  }
};


$.ajaxSetup({
  cache: false
});

var nil = function() { };


// Basic wrapper for localStorage
var localJSON = (function(){
  if (!localStorage) {
    return false;
  }
  return {
    set: function(prop, val) {
      localStorage.setItem(prop, JSON.stringify(val));
    },
    get: function(prop, def) {
      return JSON.parse(localStorage.getItem(prop) || 'false') || def;
    },
    remove: function(prop) {
      localStorage.removeItem(prop);
    }
  };
})();


// parseUri 1.2.2
// (c) Steven Levithan <stevenlevithan.com>
// MIT License

function parseUri (str) {

  var o = parseUri.options;
  var m = o.parser[o.strictMode ? "strict" : "loose"].exec(str);
  var uri = {};
  var i = 14;

  while (i--) uri[o.key[i]] = m[i] || "";

  uri[o.q.name] = {};
  uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
    if ($1) uri[o.q.name][$1] = $2;
  });

  return uri;
};

parseUri.options = {
  strictMode: false,
  key: ["source", "protocol", "authority", "userInfo", "user",
        "password", "host", "port", "relative", "path", "directory",
        "file", "query", "anchor"],
  q:   {
    name:   "queryKey",
    parser: /(?:^|&)([^&=]*)=?([^&]*)/g
  },
  parser: {
    strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
    loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
  }
};

var Tasks = (function () {

  var datePicker = function(nDate, done) {

    var $dom = $($("#date_dialog_tpl").html());
    var date = nDate;

    var $day = $dom.find(".day_label");
    var $month = $dom.find(".month_label");
    var $year = $dom.find(".year_label");
    var $date = $dom.find(".date_label");

    var inc = {
      day: function(mult) {
        date.setDate(date.getDate() + mult);
      },
      month: function(mult) {
        date.setMonth(date.getMonth() + mult);
      },
      year: function(mult) {
        date.setYear(date.getFullYear() + mult);
      },
    };


    var close = function() {
      $dom.remove();
    };


    var updateDate = function() {
      $day.text(date.getDate());
      $month.text(months[date.getMonth()]);
      $year.text(date.getFullYear() % 1000);
      $date.text(formatDate(date));
    }


    $dom.find(".cancel").bind('mousedown', function() {
      close();
    });


    $dom.find(".set_date").bind('mousedown', function() {
      done(date);
      close();
    });


    $dom.find(".inc").bind('mousedown', function() {
      var mult = $(this).val() === '-' ? -1 : 1;
      inc[$(this).data('key')](mult);
      updateDate();
    });


    updateDate(date);


    return {
      dom: $dom
    };

  };


  var syncHost = config.couch.host + ':' + config.couch.port;

  // This is the list of predefined tag colours, if there are more tags
  // than colours then tags turn black
  var tagColors = [
    '#288BC2', '#DB2927', '#17B546', '#EB563E', '#AF546A', '#4A4298',
    '#E7CD17', '#651890', '#E1B931', '#978780', '#CC7E5B', '#7C3F09',
    '#978780', '#07082F'
  ];

  var taskEstimates = [
    {value: 10, text: '10 Minutes'},
    {value: 30, text: '30 Minutes'},
    {value: 60, text: '1 Hour'},
    {value: 120, text: '2 Hours'},
    {value: 240, text: '4 Hours'}
  ];

  var days = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
  ];

  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  var months_abbr = [
    'Jan', 'Feb', 'March', 'April', 'May', 'June',
    'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  var plainCouchApp = /_design\/couchtasks/.test(document.location.pathname);

  if (!plainCouchApp) {
    $.couch.urlPrefix = "/couch";
  }

  var parts = document.location.pathname.split('/');
  var dbName = plainCouchApp ? parts[1] : parts[2];
  var $db = $.couch.db(dbName);
  var $changes;


  var router = Router();

  var paneWidth = 0;
  var currentOffset = 0;
  var lastPane = null;

  var myChanges = [];
  var current_tpl = null;


  router.get('#/?', function (_, t) {
    router.forward('#/tags/');
  });


  router.get('#/sync/', function (_, id) {

    if (plainCouchApp) {
      var syncinfo = $db.openDoc("_local/config", {error:nil});
      var tasks = $.couch.activeTasks({error: nil});

      $.when(syncinfo, tasks).always(function (info, repls) {
        var config = info[0];
        var registered = config && config.sync;
        var active = registered && arrayAny(repls[0], isPullReplication) &&
          arrayAny(repls[0], isPushReplication);

        render('sync_tpl', {}, {
          username: registered && config.sync.username || "",
          password: registered && config.sync.password || "",
          registered: registered,
          active: active
        });
      });
    } else {
      render('logout_tpl');
    }
  });

  function isPullReplication(doc) {
    return doc.target === dbName &&
      parseUri(doc.source).host === syncHost;
  }


  function isPushReplication(doc) {
    return doc.source === dbName &&
      parseUri(doc.target).host === syncHost;
  }


  router.get('#/task/:id/', function (_, id) {

    $.when(getTags(), $db.openDoc(id)).then(function(tags, doc) {

      doc = doc[0];
      doc.estimate = doc.estimate || 60;

      if (doc.due_date) {
        doc.date = formatDate2(Date.parse(doc.due_date.substring(0, 10)));
      }

      doc.tags = $.each(tags, function(_, obj) {
        obj.active = !($.inArray(obj.tag, doc.tags) === -1);
      });

      doc.estimates = $.each($.extend(true, [], taskEstimates), function(_, obj) {
        if (obj.value === doc.estimate) {
          obj.selected = true;
        }
      });

      render('task_tpl', null, doc, function(dom) {

        var $replace = $('<span class="date_replace button"></span>');
        var $date = $('input[type=date]', dom[0]);

        var init = doc.due_date ? Date.parse(doc.due_date.substring(0, 10))
          : Date.today();
        $replace.text(formatDate3(init));

        $date.hide().after($replace);

        $replace.bind('click', function(e) {
          var date = $date.val() === '' ? Date.today() : Date.parse($date.val());
          var dateWidget = new datePicker(date, function(date) {
            $date.val(formatDate2(date));
            $replace.text(formatDate3(date));
          });
          $("body").append(dateWidget.dom);
        });

        $('a.tag', dom[0]).live('click', function(e) {
          $(e.target).toggleClass('active');
        });

      });
    });

  });


  router.get('#/tags/*test', function (_, t) {
    var opts = {
      showFilters: localJSON.get('showFilters', false)
    };
    render('home_tpl', '#home_content', opts, function(dom) {
      $('a.tag', dom[0]).live('click', function(e) {
        updateFilterUrl($(e.target).data('key'));
      });
    }).then(updateTaskList);
  });


  router.post('#delete_sync', function (_, e, details) {
    cancelSync().then(function() {
      $db.openDoc("_local/config", {error:nil}).then(function(config) {
        delete config.sync;
        $db.saveDoc(config).then(router.refresh);
      });
    });
  });


  function cancelSync() {
    var dfd = $.Deferred();
    $.couch.activeTasks().then(function(tasks) {
      var push = _.select(tasks, isPushReplication)[0];
      var pull = _.select(tasks, isPullReplication)[0];
      $.when(cancelReplication(push), cancelReplication(pull)).then(function() {
        dfd.resolve();
      });
    });
    return dfd.promise();
  }


  function cancelReplication(repl) {
    if (!repl) {
      var dfd = $.Deferred();
      dfd.resolve();
      return dfd.promise();
    }
    var obj = {
      replication_id: repl.replication_id,
      cancel: true
    };
    return $.ajax({
      type: 'POST',
      url: '/_replicate',
      contentType: 'application/json',
      data: JSON.stringify(obj)
    });
  }


  router.post('#logout', function() {
    $.couch.logout().then(function() {
      document.location.href = '/';
    });
  });


  router.post('#toggle_sync', function (_d, e, details) {

    $("#repl_status").val("Saving...");

    if (details.active !== 'false') {

      cancelSync().then(function() {
        router.refresh();
      });

    } else {

      var opts = {continuous: true};
      var local = 'couchtasks';
      var remote = 'http://' + details.username + ':' + details.password + '@' +
        syncHost + '/' + details.username;

      $.when($.couch.replicate(local, remote, {error:nil}, opts),
             $.couch.replicate(remote, local, {error:nil}, opts)).then(function() {
               router.refresh();
             }).fail(function() {
               $("#repl_status").val("Failed!");
             });
    }
  });


  router.post('#create_sync', function (_, e, details) {

    var saveDetails = function(config) {

      config.sync = {
        username: details.username,
        password: details.password
      };

      $db.saveDoc(config).then(function() {
        router.refresh();
      });
    };

    $db.openDoc("_local/config", {error:nil}).then(function(config) {
      saveDetails(config);
    }).fail(function() {
      saveDetails({_id: "_local/config"});
    });
  });


  router.post('#edit', function (_, e, details) {

    $db.openDoc(details.id).then(function (doc) {

      var tags = [];
      var parsedTags = extractHashTags(details.title);

      $('.tag_wrapper .tag.active').each(function () {
        tags.push($(this).attr('data-key'));
      });

      if (Date.parse(details.due_date)) {
        doc.due_date = Date.parse(details.due_date);
      }

      doc.estimate = parseInt(details.estimate, 10);
      doc.tags = tags.concat(parsedTags.tags);
      doc.title = parsedTags.text;
      doc.notes = details.notes;
      doc.check = details.completed && details.completed === 'on';

      $db.saveDoc(doc).then(function() {
        router.back();
      });

    });
  });


  router.post('#add_task', function (_, e, details) {

    var doc = extractHashTags(details.title);
    var top = $('#tasks_wrapper li:not(.date)').first();
    var index = top.data('index') + 1 || 1;

    if(doc.text === '') {
      return;
    }

    $db.saveDoc({
      type: 'task',
      index: index,
      check: false,
      title: doc.text,
      tags: doc.tags
    }).then(function (data) {
      $('#add_task_input').val('');
    });

  });


  router.post('#delete_task', function (_, e, details) {
    $db.removeDoc({_id: details.id, _rev: details.rev}).then(function() {
      router.back();
    });
  });


  function markDone(e) {

    var status = $(this).is(':checked');
    var li = $(e.target).parents("li");
    var id = li.attr("data-id");

    myChanges.push(id);

    $db.updateDoc("couchtasks/update_status", id, {status:status}).then(function() {
      if (current_tpl !== 'home_tpl') {
        if (status) {
          li.addClass('deleted');
        } else {
          li.removeClass('deleted');
        }
      } else {
        var ul = li.parent("ul");
        if (status) {
          li.detach();
            li.addClass('deleted');
          li.appendTo(ul);
        } else {
          li.detach();
          li.removeClass('deleted');
          var index = li.data("index");
          var obj;
          ul.children().each(function(_, child) {
            if ($(child).data("index") < index) {
              obj = child;
              return false;
            }
          });
          if (!obj) {
            li.appendTo(ul);
          } else {
            li.insertBefore(obj || ul);
          }
        }
      }
    });
  }


  function updateIndex(id, index) {
    $db.updateDoc("couchtasks/update_index", id, {index:index});
  }


  function render(tpl, dom, data, init) {

    data = data || {};

    var dfd = $.Deferred();

    $('body').removeClass(current_tpl).addClass(tpl);

    var rendered = Mustache.to_html($("#" + tpl).html(), data),
    $pane = $('<div class="pane"><div class="content">' + rendered + '</div></div>');
    createCheckBox($pane);

    if (init) {
      init($pane);
    }

    if (current_tpl) {
      currentOffset += (calcIndex(tpl, current_tpl)) ? paneWidth : -paneWidth;
    }

    var tmp = lastPane;
    $('#content').one('webkitTransitionEnd transitionend', function() {
      if (tmp) {
        tmp.remove();
        tmp = null;
      }
      dfd.resolve();
    });

    transformX($pane, currentOffset);
    $pane.appendTo($('#content'));

    transformX($('#content'), -currentOffset);
    lastPane = $pane;
    current_tpl = tpl;

    return dfd.promise();
  }


  function calcIndex(a, b) {
    var indexii = {home_tpl:1, complete_tpl:2, sync_tpl:3, task_tpl:4};
    return indexii[a] > indexii[b];
  }


  function fetchAllTasks(start, limit) {
    var dfd = $.Deferred();
    $db.view('couchtasks/tasks', {
      descending: true,
      include_docs: true,
      skip: start,
      limit: limit
    }).then(function (data) {
      dfd.resolve(data);
    });
    return dfd;
  }

  // Keep an index of all the last currently read item for each tag, this
  // lets us start pagination from the last tag shown
  var startIndexes = {};

  function fetchTaggedTasks(start, limit) {

    var dfd = $.Deferred();
    var tasks = [];
    var uriTags = tagsFromUrl();
    var moreTasks = false;

    var tagViews = function(tag) {
      return $db.view('couchtasks/tags', {
        reduce:false,
        include_docs: true,
        startkey: [tag],
        endkey: [tag],
        skip: startIndexes[tag] || 0,
        limit: limit
      }).pipe(function(data) {
        return [data, tag];
      });
    }

    $.when.apply(this, $.map(uriTags, tagViews)).then(function () {

      $.each(arguments, function(_, el) {

        var tag = el[1];
        startIndexes[tag] = (startIndexes[tag] || 0);

        if (!moreTasks && el[0].total_rows > (el[0].offset + limit)) {
          moreTasks = true;
        }

        fetchedAllRows = el[0].total_rows < el[0].offset + limit;

        $.each(el[0].rows, function(_, row) {

          ++startIndexes[tag];

          var exists = function(doc) {
            return doc.id === row.id;
          };

          if (arraySubset(uriTags, row.doc.tags) && !arrayAny(tasks, exists)) {
            tasks.push(row);
          }

        });
      });

      dfd.resolve({
        total_rows: moreTasks,
        rows: tasks
      });

    });

    return dfd.promise();
  }


  function updateTaskList() {

    startIndexes = {};

    var fun = (!tagsFromUrl().length) ? fetchAllTasks : fetchTaggedTasks;
    var tags = null, tasks = null;
    var start = 0;
    var limit = 10;

    // A tag intersection request may return few or no results, if it Fetches
    // less than the limit, recusrse until there are at least limit items, or
    // there are no more items to fetch
    var renderOrFetch = function(count) {
      if (tasks.total_rows === true && count < limit) {
        paginate();
      } else {
        renderTasksList(tasks, tags, loadMore, start + limit);
      }
    }

    var loadMore = function() {
      start += limit;
      $.when(fun(start, limit)).then(function(newtasks) {
        var rows = tasks.rows.concat(newtasks.rows);
        tasks = newtasks;
        tasks.rows = rows;
        renderOrFetch(newtasks.rows.length);
      });
    };

    $.when(getTags(), fun(start, limit)).then(function(aTags, aTasks) {
      tasks = aTasks;
      tags = aTags;
      renderOrFetch(aTasks.rows.length);
    });
  }


  function renderTasksList(tasks, tags, updateFun, max) {

    tasks.rows.sort(function(a, b) { return b.doc.index - a.doc.index; });

    var date = new Date();
    var today = new Date();
    var lists = {};
    var completedlists = {};
    var hour = 0;

    $.each(tasks.rows, function(_, obj) {

      obj = obj.doc;
      obj.estimate = obj.estimate || 60;

      var thisDate = obj.check ? new Date() : date;

      if (obj.due_date) {
        thisDate = Date.parse(obj.due_date.substring(0, 10));
      }

      if (obj.check && obj.check_at) {
        thisDate = Date.parse(obj.check_at.substring(0, 10));
      }

      var groupKey = thisDate.getYear() + "-" + thisDate.getMonth() + "-" +
        thisDate.getDate() + (!!obj.check ? "completed" : "todo") ;

      if (typeof lists[groupKey] === 'undefined') {
        lists[groupKey] = {
          jsonDate: thisDate,
          date:formatDate(thisDate),
          notes: [],
          completed: !!obj.check
        };
      }
      lists[groupKey].notes.push(obj);
      if (!obj.check) {
        hour += obj.estimate;
      }
      if (hour >= (8 * 60)) {
        hour = 0;
        date.setDate(date.getDate() + 1);
      }
    });

    var obj = {tasklist: []};

    for (var x in lists) {
      obj.tasklist.push(lists[x]);
    }

    obj.tasklist.sort( function(a, b) {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      } else {
        return (a.jsonDate > b.jsonDate) ? 1 : -1;
      }
    });

    var rendered =
      $('<div>' + Mustache.to_html($('#rows_tpl').html(), obj) + '</div>');
    createCheckBox(rendered);
    $('.checker', rendered).bind('change', markDone);

    $.each(tags, function(_, obj) {
      obj.active = !($.inArray(obj.tag, tagsFromUrl()) === -1);
    });

    var renderedTags =
      $('<div>' + Mustache.to_html($('#tags_tpl').html(), {tags: tags}) +
        '</div>');

    if (!tags.length) {
      $("#show_filters_btn").removeClass('active');
      $('#filter_tags').hide();
      localJSON.set('showFilters', false);
    } else {
      $("#show_filters_btn").addClass('active');
    }

    $('#filter_tags').empty().append(renderedTags.children());
    $('#tasks_wrapper').empty().append(rendered.children());

    var wrapper = $('<div id="load_btn_wrapper" />');
    var btn = $('<button id="load_more_btn"></button>');

    if (tasks.total_rows === false ||
        (typeof tasks.total_rows === 'number' && tasks.total_rows < max)) {
      btn.text("No More Tasks");
    } else {
      btn.addClass('active').text("Load More Tasks").bind('mousedown', function() {
        btn.text("Loading");
        updateFun();
      });
    }
    btn.appendTo(wrapper);
    wrapper.appendTo($('#tasks_wrapper'));

    if (!Utils.isMobile()) {
      $('#tasks_wrapper ul').sortable({
        connectWith: $('#tasks_wrapper ul'),
        items: 'li:not(.date)',
        axis:'y',
        distance:30,
        start: function(event, ui) {
          ui.item.attr('data-noclick','true');
        },
        stop: function(event, ui) {
          var index = createIndex(ui.item);
          if (index !== false) {
            updateIndex(ui.item.attr('data-id'), index);
          }
        }
      });
    }
  }

  /*
   * Update filter url, adding or removing the key as needed
   */
  function updateFilterUrl(key) {
    var keys = arrayToggle(tagsFromUrl(), key);
    document.location.hash = '#/' + ((keys.length) ? 'tags/' + keys.join(',') : '');
  }


  /*
   * If a key is in the array, remove it, otherwise add it
   */
  function arrayToggle(arr, key) {
    if ($.inArray(key, arr) === -1) {
      arr.push(key);
    } else {
      arr = $.grep(arr, function(x) { return x !== key; });
    }
    return arr;
  }


  /*
   * Returns a list of tags that are specified in the current url under
   * the #/tags/ uri
   */
  function tagsFromUrl() {
    var match = router.matchesCurrent('#/tags/*test');
    return $.grep(match[1].split(','), function(x) { return x !== ''; });
  }


  /*
   * Return true if any of the items in the array satifies the anyFun predicate
   */
  function arrayAny(arr, anyFun) {
    for(var obj in arr) {
      if (anyFun(arr[obj])) {
        return true;
      }
    }
    return false;
  }


  /*
   * Naive implementation to check that arr1 is a full subset of arr2
   */
  function arraySubset(arr1, arr2) {
    var i = 0;
    $.each(arr1, function(_, val) {
      if ($.inArray(val, arr2) !== -1) {
        ++i;
      }
    });
    return i === arr1.length;
  }


  /*
   * Each task is given a numerical index which defines what order they
   * should be displayed in, when we reorder something calculate its index
   * based on the surrounding tasks
   */
  function createIndex(el) {

    var before = el.prev('li.task');
    var after = el.next('li.task');

    if (before.length === 0 && after.length === 0) {
      return false;
    } else if (before.length === 0) {
      return after.data('index') + 1;
    } else if (after.length === 0) {
      return before.data('index') - 1;
    } else {
      return (before.data('index') + after.data('index')) / 2;
    }
  }


  /*
   * Wrapper function for cross browser transforms
   */
  function transformX(dom, x) {
    if (Modernizr.csstransforms3d) {
      dom.css("-moz-transform", "translate3d(" + x + "px, 0, 0)")
        .css("-webkit-transform", "translate3d(" + x + "px, 0, 0)");
    } else {
      dom.css("-moz-transform", "translate(" + x + "px, 0)")
        .css("-webkit-transform", "translate(" + x + "px, 0)");
    }
  }


  /*
   * Android makes butt ugly checkboxes, so we just make our own with images
   * initialises checkboxes for everything inside 'parent', this needs to be
   * run on anything dynamically put into DOM
   */
  function createCheckBox(parent) {
    $('input[type=checkbox]', parent).each(function() {
      var $input = $(this).wrap('<div class="checkbox"></div>');
      var $wrapper = $(this).parent(".checkbox").append('<div />');
      if ($input.is(':checked')) {
        $wrapper.addClass('checked');
      }
      $wrapper.bind('click', function(){
        $wrapper.toggleClass('checked');
        $input.attr('checked', !$input.is(':checked')).change();
      });
    });
  };


  /*
   * Given a string "a random string #with #tags" parse out the hash tags
   * and return the tags and plain string seperately
   */
  function extractHashTags(text) {

    var matches = text.match(/#([^\s]*)/g) || [];
    var tags = $.map(matches, function(tag) { return tag.slice(1); });

    return {
      tags: tags,
      text: text.replace(/#([^\s]*)/g, '').trim()
    };
  }


  /*
   * What it says on the tin
   */
  function formatDate(date) {
    var d = date.getDate();
    var prefix = (d === 1) ? 'st' : (d === 2) ? 'nd' : (d === 3) ? 'rd' : 'th';
    return days[date.getDay()] + " " + date.getDate() + prefix +
      " of " + months[date.getMonth()] + ', ' + date.getFullYear();
  }


  /*
   * What it says on the tin
   */
  function formatDate2(date) {
    return (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear();
  }


  /*
   * What it says on the tin
   */
  function formatDate3(date) {
    var d = date.getDate();
    var prefix = (d === 1) ? 'st' : (d === 2) ? 'nd' : (d === 3) ? 'rd' : 'th';
    return days[date.getDay()] + " " + date.getDate() + prefix +
      ' ' + months_abbr[date.getMonth()] + ', ' + date.getFullYear();
  }


  /*
   * Fetches the current set of tags from a CouchDB view, for every tag we
   * ensure there is a corresponding style definition for its colour
   */
  function getTags() {

    var dfd = $.Deferred();

    $db.view('couchtasks/tags', {group: true}).then(function(data) {
      var i = 0, css = [], tags = [];
      $.each(data.rows, function(_, tag) {
        css.push('.tag_' + tag.key[0] + ' { background: ' + tagColors[i++] + ' }');
        tags.push({tag: tag.key[0], count: tag.value});
      });

      $("#tag_defs").html(css.join('\n'));
      dfd.resolve(tags);
    });

    return dfd.promise();
  };


  /*
   * Handles any incoming real time changes from CouchDB, this will either
   * trigger a full page load if the design doc has changed, or update
   * the current list of tasks if needed
   */
  function handleChanges() {

    $changes = $db.changes();
    $changes.onChange(function(changes) {

      var doRefresh = false;

      $.each(changes.results, function(_, change) {

        // Full refresh if design doc changes
        if (/^_design/.test(change.id)) {
          document.location.reload();
        }

        // Otherwise check for changes that we didnt cause
        if (!doRefresh && $.inArray(change.id, myChanges) === -1) {
          doRefresh = true;
          myChanges = [];
        }

      });

      if (doRefresh && router.matchesCurrent('#/tags/*test')) {
        updateTaskList();
      }

    });
  }


  // the animation stuff needs to know the width of the browser
  $(window).bind('resize', function () {
    paneWidth = $('body').width();
  }).trigger('resize');


  // The layout wont let me put the submit button inside the form
  // proxy the submit button
  $('#save_task_btn').bind('click', function (e) {
    $('#edit_task_form').trigger('submit');
  });


  $('#show_filters_btn').bind('click', function (e) {

    var $filter_ui = $('#filter_tags');
    var visible = !$filter_ui.is(":visible");

    localJSON.set('showFilters', visible);
    $filter_ui[visible ? 'show' : 'hide']();

  });


  // Only start handling real time updates after a delay to get round
  // a silly bug in webkit that shows a page as still loading if ajax
  // requests are made before the whole page has loaded
  setTimeout(handleChanges, 1000);

  // Lets start this baby
  (function() {
    var source = 'http://' + syncHost + '/master';
    $.couch.replicate(source, dbName, {error:nil}).then(function() {
      router.init(window);
    });
  })();

  $('header').noisy({
    intensity: 1,
    size: 200,
    monochrome: false
  });

})();
