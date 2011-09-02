/*jshint */

window.log = function(){
  log.history = log.history || [];
  log.history.push(arguments);
  if(this.console){
    console.log( Array.prototype.slice.call(arguments) );
  }
};

$.ajaxSetup({
  cache: false
});

// Doesnt handle ghosted events, will survive for now
var pressed = Utils.isMobile() ? "click" : "click";

var Tasks = (function () {

  // Override link behaviour for mobiles because they are so damn slow
  if (Utils.isMobile()) {

    $(document).bind("touchend", function(e) {
      if (e.target.nodeName === 'A' && e.target.getAttribute('href')) {
        e.preventDefault();
        document.location.href = e.target.getAttribute('href');
      }
    });
  }

  var mainDb  = document.location.pathname.split("/")[1],
  hostCouch = "http://couchbase.ic.ht/grocery-sync",
  $changes,
  paneWidth = 0,
  isMobile = Utils.isMobile(),
  router  = new Router(),
  current_tpl = null,
  slidePane = null,
  docs    = {},
  tasks   = [],
  servers = [],
  zIndex  = 0,
  currentOffset = 0,
  lastPane = null,
  $db     = $.couch.db(mainDb);

  var templates = {
    addserver_tpl : {
      transition: "slideUp",
      events: { '.deleteserver' : {'event': pressed, 'callback' : deleteServer},
                'input' : {'event':"keyup", 'callback' : checkCanSaveServer}}
    },
    addtask_tpl : {
      events: { 'input,textarea' : {'event':"keyup", 'callback' : checkCanSaveNote}},
      transition: "slideUp"
    },
    task_tpl : { transition: "slideHorizontal" },
    sync_tpl : {
      transition: "slideHorizontal",
      events : {
        '.sync' : {'event': pressed, 'callback' : doSync}
      }
    },
    home_tpl : {
      transition : "slideHorizontal",
      events : {
        '.checker' : {'event': 'change', 'callback' : markDone},
        '.task' : {'event': pressed, 'callback' : viewTask},
        '.delete' : {'event': pressed, 'callback' : deleteTask}
      },
      init : function(dom) {
        // if (!isMobile) {
        //   $("#notelist", dom).sortable({
        //     items: "li:not(.header)",
        //     axis:'y',
        //     distance:30,
        //     start: function(event, ui) {
        //       ui.item.attr("data-noclick","true");
        //     },
        //     stop: function(event, ui) {
        //       var index = createIndex(ui.item);
        //       if (index !== false) {
        //         updateIndex(ui.item.attr("data-id"), index);
        //       }
        //     }
        //   });
        // }
      }
    }
  };

  templates.complete_tpl = templates.home_tpl;

  router.get(/^(!)?$/, function () {
    view('grocery/recent-items', {
      descending: true,
      success : function (data) {
        tasks = getValues(data.rows);
        render(/^(!)?$/, "home_tpl", "#home_content", {notes:tasks});
      }
    });
  });

  router.get('!/add_server/', function () {
    view('couchtasks/servers', {
      success : function (data) {
        servers = getValues(data.rows);
        render('!/add_server/', "addserver_tpl", "#add_server", {servers:servers});
      }
    });
  });

  router.get('!/add_task/', function () {
    render('!/add_task/', "addtask_tpl", "#add_content");
  });

  router.get('!/complete/', function (id) {
    $db.view('couchtasks/complete', {
      descending: true,
      success : function (data) {
        tasks = getValues(data.rows);
        render('!/complete/', "complete_tpl", "#complete_content", {notes:tasks});
      }
    });
  });

  router.get('!/sync/', function (id) {
    $db.view('couchtasks/servers', {
      success : function (data) {
        servers = getValues(data.rows);
        render('!/sync/', "sync_tpl", "#sync_content", {servers:servers});
      }
    });
  });

  router.get('!/task/:id/', function (id) {
    $db.openDoc(id, {
      success: function(doc) {
        docs[doc._id] = doc;
        doc.completed = doc.status === "complete" ? "checked='checked'" : "";
        render('!/task/:id/', "task_tpl", null, doc);
      }
    });
  });

  router.post('edit', function (e, details) {
    $db.openDoc(details.id).then(function(doc) {
      console.log(doc);
    });
    // var doc = docs[details.id];
    // doc.notes = details.notes;
    // doc.status = details.completed && details.completed === "on" ?
    //   "complete" : "active";
    // $db.saveDoc(doc, {"success": function () {
    //   viewCache = {};
    //   router.back();
    // }});
  });

  router.post('add_server', function (e, details) {
    if (details.server === "") {
      $("input[name=server]").addClass("formerror");
      return;
    }
    details.type = "server";
    $db.saveDoc(details, {"success": function () {
      viewCache = {};
      router.back();
    }});
  });

  router.post('add_task', function (e, details) {
    newTask(details.title, details.notes, function () {
      viewCache = {};
      //router.refresh();
    });
  });

  var viewCache = {};
  function view(name, options) {
    if (typeof viewCache[name] === "undefined") {
      var success = options.success;
      options.success = function (data) {
        viewCache[name] = data;
        success(data);
      };
      $db.view(name, options);
    } else {
      options.success(viewCache[name]);
    }
  }

  function markDone(e) {

    var status = {
      "home_tpl": {"checked": "complete", "unchecked": "active"},
      "complete_tpl": {"checked": "active", "unchecked": "complete"}
    };

    var li = $(e.target).parents("li");
    var id = li.attr("data-id");

    $db.openDoc(id, {
      success: function(doc) {
        doc.check = !doc.check;
        $db.saveDoc(doc, {
          success: function() {
            if (!doc.check) {
              li.removeClass("deleted");
            } else {
              li.addClass("deleted");
            }
          }
        });
      }
    });
  }

  function updateIndex(id, index) {
    var url = "/" + mainDb + "/_design/couchtasks/_update/update_index/" + id +
      "?index=" + index;
    $.ajax({
      url: url,
      type: "PUT",
      contentType:"application/json",
      datatype:"json",
      success: function() {
        viewCache = {};
      }
    });
  }

  function createIndex(el) {

    var before = el.prev("li.task"),
        after = el.next("li.task");

    if (before.length === 0 && after.length === 0) {
      return false;
    } else if (before.length === 0) {
      return parseInt(after.attr("data-index"), 10) + 1;
    } else if (after.length === 0) {
      return parseInt(before.attr("data-index"), 10) - 1;
    } else {
      return (parseInt(before.attr("data-index"), 10) +
              parseInt(after.attr("data-index"), 10)) / 2;
    }
  }

  function getValues(src) {
    var arr = [], i;
    for (i = 0; i < src.length; i++) {
      arr.push(src[i].value);
    }
    return arr;
  }

  function render(url, tpl, dom, data) {

    if (router.matchesCurrent(url) === null) {
      return;
    }

    data = data || {};
    $("body").removeClass(current_tpl).addClass(tpl);

    var rendered = Mustache.to_html($("#" + tpl).html(), data),
    $pane = $("<div class='pane'><div class='content'>" + rendered + "</div></div>");
    createCheckBox($pane);

    // Bind this templates events
    var events = templates[tpl] && templates[tpl].events;
    if (events) {
      for (var key in events) {
        $(key, $pane).bind(events[key].event + ".custom", events[key].callback);
      }
    }

    if (templates[tpl] && templates[tpl].init) {
      templates[tpl].init($pane);
    }

    var transition = templates[tpl] && templates[tpl].transition;

    if (transition === 'slideUp') {

      $("#content").one("webkitTransitionEnd transitionend", function() {
        if (lastPane) {
          lastPane.hide();
        }
      });

      slidePane = $pane.addClass("slidepane")
        .css({left:currentOffset, top:-$(window).height(), 'z-index': 3})
        .appendTo("#content");
      transformY(slidePane, $(window).height() + 50);

    } else if (slidePane) {

      if (lastPane) {
        lastPane.remove();
        lastPane = null;
      }

      $pane.css({"left":currentOffset}).appendTo($("#content"));
      transformY(slidePane, 0);
      lastPane = $pane;

      slidePane.one("webkitTransitionEnd transitionend", function() {
        slidePane.remove();
        slidePane = null;
      });

    } else {

      // if (current_tpl) {
      //   currentOffset += (calcIndex(tpl, current_tpl)) ? paneWidth : -paneWidth;
      // }

      var tmp = lastPane;
      // $("#content").one("webkitTransitionEnd transitionend", function() {
      //   if (tmp) {
      //     tmp.remove();
      //     tmp = null;
      //   }
      // });

      // transformX($pane, currentOffset);
      $pane.appendTo($("#content"));
      if (tmp) {
        tmp.remove();
      }
      // transformX($("#content"), -currentOffset);
      lastPane = $pane;
    }
    current_tpl = tpl;
  }

  function transformY(dom, x) {
    dom.css("-moz-transform", "translate(0, " + x + "px)")
      .css("-webkit-transform", "translate(0, " + x + "px)");
  }

  function transformX(dom, x) {
    dom.css("-moz-transform", "translate(" + x + "px, 0)")
      .css("-webkit-transform", "translate(" + x + "px, 0)");
  }

  function checkCanSaveNote(e) {
    if ($("input[name=title]").val() === "") {
      $("#createtask_btn").removeClass("active");
    } else {
      $("#createtask_btn").addClass("active");
    }
  }

  function checkCanSaveServer(e) {
    if ($("input[name=server]").val() === "") {
      $("#createserver_btn").removeClass("active");
    } else {
      $("#createserver_btn").addClass("active");
    }
  }

  function calcIndex(a, b) {
    var indexii = {home_tpl:1, complete_tpl:2, sync_tpl:3, task_tpl:4};
    return indexii[a] > indexii[b];
  }

  function findTask(id) {
    for(var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) {
        return tasks[i];
      }
    }
    return false;
  }

  function newTask(title, notes, callback) {

    if(title === "") {
      $("input[name=title]").addClass("formerror");
      return;
    }

    // wont order correctly if /add_task/ is accessed directly
    var index = tasks.length > 0 ? tasks[0].index + 1 : 1;
    $db.saveDoc({
      "type":"task",
      index: index,
      created_at: new Date(),
      "status":"active",
      text:title,
      "tags":[],
      "notes":notes
    }, {
      "success": function (data) {
        callback();
      }
    });
  }

  function doReplication(obj, callbacks) {
    $.ajax({
      url: "/_replicate",
      type: 'POST',
      data: JSON.stringify(obj),
      contentType : "application/json",
      dataType : "json",
      success: callbacks.success,
      error: callbacks.error
    });
  }

  function createUrl(username, password, server, database) {
    if (username === "") {
      return "http://" + server + "/" + database;
    } else {
      return "http://" + username + ":" + password + "@" +
        server + "/" + database;
    }
  }

  function viewTask(e) {
    if ($(this).attr("data-noclick")) {
      $(this).removeAttr("data-noclick");
      return;
    }
    if (!$(e.target).is("li.task") && e.target.nodeName !== 'SPAN') {
      return;
    }
    var c = $(this).find(".checker");
    $(this).find(".checkbox").toggleClass("checked");
    c.attr("checked", !c.is(":checked")).trigger("change");
    //markDone({target:c[0]});

  }

  function doSync(e) {

    var li = $(e.target).parents("li").addClass("syncing"),
    server = li.attr("data-server"),
    database = li.attr("data-database"),
    user = li.attr("data-username"),
    pass = li.attr("data-password");

    var error = function() {
      $("#feedback").addClass("error").text("Sync Failed!").show();
      li.removeClass("syncing");
    };

    doReplication({
      create_target:true,
      filter: "couchtasks/taskfilter",
      target : createUrl(user, pass, server, database),
      source : mainDb
    }, {
      "success" : function() {
        doReplication({
          filter: "couchtasks/taskfilter",
          target : mainDb,
          source : createUrl(user, pass, server, database)
        }, { "success" : function () {
          $("#feedback").addClass("success").text("Sync Complete!").show();
          li.removeClass("syncing");
        }, error: error})
      }, error: error});
  }

  function deleteServer(e) {
    e.preventDefault();
    var li = $(e.target).parents("li");
    $db.removeDoc({_id: li.attr("data-id"), _rev: li.attr("data-rev")}, {
      success: function() {
        viewCache = {};
        li.remove();
      }
    });
  }

  function deleteTask(e) {
    e.preventDefault();
    $(e.target).css({opacity:1});
    var li = $(e.target).parents("li");
    $db.removeDoc({_id: li.attr("data-id"), _rev: li.attr("data-rev")}, {
      success: function() {
        viewCache = {};
        li.fadeOut("medium", function () {
          li.remove();
        });
      }
    });
  }

  function createCheckBox(parent) {
    $("input[type=checkbox]", parent).each(function() {
      var $input = $(this).wrap("<div class='checkbox'></div>");
      var $wrapper = $(this).parent(".checkbox").append("<div />");
      if ($input.is(":checked")) {
        $wrapper.addClass("checked");
      }
      $wrapper.bind(pressed, function(){
        $wrapper.toggleClass("checked");
        $input.attr("checked", !$input.is(":checked")).change();
      });
    });
  };

  $("#edittask_btn").bind("click", function (e) {
    $("#edit_task_form").trigger("submit");
  });

  $("#createserver_btn").bind("click", function (e) {
    $("#syncform").trigger("submit");
  });

  $("#createtask_btn").bind("click", function (e) {
    $("#add_task_frm").trigger("submit");
  });

  function startCounter() {

    var opts = {continuous:true};
    $.couch.replicate(mainDb, hostCouch, {error:function() {}}, opts);
    //$.couch.replicate(hostCouch, mainDb, {error:function() {}}, opts);

    $changes = $db.changes();
    $changes.onChange(function() {
      viewCache = {};
      router.refresh();
    });
  }

  setTimeout(startCounter, 1000);

  $(window).bind("resize", function () {
    paneWidth = $("body").width();
  });
  $(window).resize();

  router.init();

})();
